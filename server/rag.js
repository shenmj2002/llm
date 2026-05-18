import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ChromaClient } from 'chromadb'
import { get_encoding } from '@dqbd/tiktoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_PATH = path.join(__dirname, 'rag-docs.json')
const COLLECTION_NAME = 'rag_chunks'
const EMBEDDING_MODEL = 'BAAI/bge-m3'
const SILICONFLOW_EMBEDDINGS_URL = 'https://api.siliconflow.cn/v1/embeddings'
/** 每条 chunk 目标最大 token（cl100k，与 GPT 系预算习惯一致；bge-m3 内部拆分可能略有出入） */
const CHUNK_MAX_TOKENS = 384
/** 滑动窗口重叠 token，避免语义在边界被切断 */
const CHUNK_OVERLAP_TOKENS = 64
const TOP_K = 3

// ---------- ChromaDB 客户端 ----------

const chroma = new ChromaClient({ path: 'http://localhost:8001' })

async function getCollection() {
  return chroma.getOrCreateCollection({ name: COLLECTION_NAME })
}

// ---------- 文档元数据（rag-docs.json，不含向量） ----------

function loadDocs() {
  if (!fs.existsSync(DOCS_PATH)) return []
  return JSON.parse(fs.readFileSync(DOCS_PATH, 'utf-8'))
}

function saveDocs(docs) {
  fs.writeFileSync(DOCS_PATH, JSON.stringify(docs, null, 2), 'utf-8')
}

// ---------- 文本分块：结构化切分 → 合并到 token 上限 → 超大块滑窗拆分 ----------

const utf8 = new TextDecoder('utf-8')
let tiktokenEncoder = null

function getTiktoken() {
  if (!tiktokenEncoder) tiktokenEncoder = get_encoding('cl100k_base')
  return tiktokenEncoder
}

function tokenSliceToString(enc, slice) {
  return utf8.decode(enc.decode(slice)).trim()
}

function countTokens(text) {
  if (!text.trim()) return 0
  return getTiktoken().encode(text, 'all').length
}

/**
 * 按「结构」拆成原子片段：
 * - 先有 Markdown ATX 标题（#～######）则从标题处分段；
 * - 每个标题段内再按空行拆成小段（段落/列表块等在空行处分界）。
 */
function splitStructuralAtoms(text) {
  const norm = text.replace(/\r\n/g, '\n')
  /** @type {string[]} */
  const headingSections = []
  const lines = norm.split('\n')
  let buf = []
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && buf.length > 0) {
      headingSections.push(buf.join('\n'))
      buf = [line]
    } else {
      buf.push(line)
    }
  }
  if (buf.length > 0) headingSections.push(buf.join('\n'))

  const trimmedSections = headingSections.map((s) => s.trim()).filter(Boolean)

  /** @type {string[]} */
  const atoms = []
  for (const sec of trimmedSections) {
    const paras = sec.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    atoms.push(...paras)
  }
  return atoms
}

/**
 * 将超过单块上限的结构单元用 token 滑窗切开（与同一段语义连续处保留 overlap）。
 */
function chunkOversizedByTokens(segment) {
  const enc = getTiktoken()
  const tokens = enc.encode(segment, 'all')
  const n = tokens.length
  if (n === 0) return []

  if (n <= CHUNK_MAX_TOKENS) {
    const s = tokenSliceToString(enc, tokens)
    return s ? [s] : []
  }

  const out = []
  let start = 0
  while (start < n) {
    const end = Math.min(start + CHUNK_MAX_TOKENS, n)
    const s = tokenSliceToString(enc, tokens.subarray(start, end))
    if (s) out.push(s)
    if (end >= n) break
    start = Math.max(start + 1, end - CHUNK_OVERLAP_TOKENS)
  }
  return out
}

/**
 * 将结构原子按顺序贪心合并：相邻块在未超 token 上限时用 \\n\\n 拼接；
 * 单块已超过上限则先做滑窗切分。
 */
function mergeAtomsToChunks(atoms) {
  /** @type {string[]} */
  const chunks = []
  /** @type {string} */
  let buffer = ''

  const flushBuffer = () => {
    const t = buffer.trim()
    if (t) chunks.push(t)
    buffer = ''
  }

  for (const atom of atoms) {
    const t = atom.trim()
    if (!t) continue

    if (countTokens(t) > CHUNK_MAX_TOKENS) {
      flushBuffer()
      chunks.push(...chunkOversizedByTokens(t))
      continue
    }

    const merged = buffer ? `${buffer}\n\n${t}` : t
    if (!buffer || countTokens(merged) <= CHUNK_MAX_TOKENS) {
      buffer = merged
    } else {
      flushBuffer()
      buffer = t
    }
  }
  flushBuffer()
  return chunks
}

export function chunkText(text) {
  const atoms = splitStructuralAtoms(text)
  const chunks = mergeAtomsToChunks(atoms)
  return chunks.filter((c) => c.length >= 10)
}

// ---------- Embeddings API ----------

export async function getEmbedding(text, apiKey) {
  const res = await fetch(SILICONFLOW_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embeddings API error ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.data[0].embedding
}

// ---------- 对外接口 ----------

/** 上传并向量化文档，返回新文档信息 */
export async function addDocument(fileName, fileContent, apiKey) {
  const existing = loadDocs().find(d => d.name === fileName)
  if (existing) {
    throw new Error(`文档「${fileName}」已存在，请先删除再重新上传`)
  }

  const chunks = chunkText(fileContent)
  if (chunks.length === 0) {
    throw new Error('文件内容为空或无法提取有效文本，请检查文件是否有内容（每段需至少 10 个字符）')
  }

  const docId = `doc_${Date.now()}`
  const collection = await getCollection()

  const ids = []
  const embeddings = []
  const documents = []
  const metadatas = []

  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await getEmbedding(chunks[i], apiKey)
      ids.push(`${docId}_chunk_${i}`)
      embeddings.push(embedding)
      documents.push(chunks[i])
      metadatas.push({ docId, docName: fileName })
    } catch (err) {
      throw new Error(`第 ${i + 1} 块向量化失败：${err.message}`)
    }
  }

  await collection.add({ ids, embeddings, documents, metadatas })

  const doc = { id: docId, name: fileName, uploadedAt: Date.now(), chunkCount: chunks.length }
  const docs = loadDocs()
  docs.push(doc)
  saveDocs(docs)

  return doc
}

/** 列出所有文档（不含向量） */
export function listDocuments() {
  return loadDocs()
}

/** 删除文档及其所有 chunks */
export async function deleteDocument(docId) {
  const docs = loadDocs()
  const before = docs.length
  const remaining = docs.filter(d => d.id !== docId)
  if (remaining.length === before) return false

  const collection = await getCollection()
  await collection.delete({ where: { docId } })

  saveDocs(remaining)
  return true
}

/** 检索与 query 最相关的 Top-K 文本块 */
export async function retrieveChunks(query, apiKey) {
  const collection = await getCollection()
  const count = await collection.count()
  if (count === 0) return []

  const queryEmbedding = await getEmbedding(query, apiKey)
  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: Math.min(TOP_K, count),
    include: ['documents', 'metadatas', 'distances'],
  })

  const docs = results.documents[0] || []
  const metas = results.metadatas[0] || []
  /** Chroma QueryResult 总是带每条检索结果的 id（与 embeddings 条目一一对应） */
  const idList = results.ids?.[0] || []

  return docs.map((text, i) => ({
    text,
    docName: metas[i]?.docName || '未知文档',
    docId: metas[i]?.docId != null ? String(metas[i].docId) : '',
    chunkId: idList[i] != null ? String(idList[i]) : '',
  }))
}
