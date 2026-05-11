import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ChromaClient } from 'chromadb'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_PATH = path.join(__dirname, 'rag-docs.json')
const COLLECTION_NAME = 'rag_chunks'
const EMBEDDING_MODEL = 'BAAI/bge-m3'
const SILICONFLOW_EMBEDDINGS_URL = 'https://api.siliconflow.cn/v1/embeddings'
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50
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

// ---------- 文本分块 ----------

export function chunkText(text) {
  const chunks = []
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  for (const para of paragraphs) {
    if (para.length <= CHUNK_SIZE) {
      chunks.push(para)
      continue
    }
    const lines = para.split(/\n/).map(l => l.trim()).filter(Boolean)
    let buf = ''
    for (const line of lines) {
      if ((buf + '\n' + line).length > CHUNK_SIZE && buf) {
        chunks.push(buf.trim())
        buf = buf.slice(-CHUNK_OVERLAP) + '\n' + line
      } else {
        buf = buf ? buf + '\n' + line : line
      }
    }
    if (buf.trim()) chunks.push(buf.trim())
  }

  return chunks.filter(c => c.length >= 10)
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

  return docs.map((text, i) => ({
    text,
    docName: metas[i]?.docName || '未知文档',
  }))
}
