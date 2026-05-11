import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import { addDocument, listDocuments, deleteDocument, retrieveChunks } from './rag.js'

const app = express()
const PORT = process.env.SERVER_PORT || 3001
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/chat/completions'

app.use(express.json({ limit: '20mb' }))

// multer：文件存在内存中，不落磁盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(req, file, cb) {
    const allowed = ['.txt', '.md']
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error('只支持 .txt 和 .md 文件'))
  },
})

// ---------- RAG 路由 ----------

// 上传文档
app.post('/api/rag/upload', upload.single('file'), async (req, res) => {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'LLM_API_KEY is not set' })
  if (!req.file) return res.status(400).json({ error: '未收到文件' })

  try {
    // multer 默认用 latin1 存文件名，中文文件名需转回 UTF-8
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf-8')
    const content = req.file.buffer.toString('utf-8')
    const doc = await addDocument(fileName, content, apiKey)
    res.json({ success: true, document: doc })
  } catch (err) {
    console.error('[/api/rag/upload] error:', err)
    res.status(500).json({ error: err.message })
  }
})

// 文档列表
app.get('/api/rag/documents', (req, res) => {
  try {
    res.json(listDocuments())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 删除文档
app.delete('/api/rag/documents/:id', async (req, res) => {
  try {
    const ok = await deleteDocument(req.params.id)
    if (!ok) return res.status(404).json({ error: '文档不存在' })
    res.json({ success: true })
  } catch (err) {
    console.error('[/api/rag/documents] delete error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ---------- Chat 路由 ----------

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'LLM_API_KEY is not set in .env' })

  try {
    let { ragEnabled, ...llmPayload } = req.body

    // RAG 检索：把相关内容注入 system prompt
    if (ragEnabled) {
      const userMessages = llmPayload.messages.filter(m => m.role === 'user')
      const rawContent = userMessages[userMessages.length - 1]?.content || ''
      // content 可能是字符串（普通消息）或数组（多模态消息），只取文字部分做检索
      const lastUserQuery = Array.isArray(rawContent)
        ? rawContent.filter(p => p.type === 'text').map(p => p.text || '').join('\n')
        : rawContent

      if (lastUserQuery) {
        const chunks = await retrieveChunks(lastUserQuery, apiKey)
        if (chunks.length > 0) {
          const context = chunks.map((c, i) => `[${i + 1}] (来源: ${c.docName})\n${c.text}`).join('\n\n')
          const systemMessage = {
            role: 'system',
            content: `你是一个知识库助手，请优先基于以下参考资料回答问题，资料中没有的内容可以结合自身知识补充。\n\n参考资料：\n${context}`,
          }
          llmPayload.messages = [systemMessage, ...llmPayload.messages]
        }
      }
    }

    const upstream = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(llmPayload),
    })

    // 非 2xx 时打印 SiliconFlow 的错误体，方便排查
    if (!upstream.ok) {
      const errBody = await upstream.text()
      console.error(`[/api/chat] SiliconFlow ${upstream.status}:`, errBody)
      return res.status(upstream.status).json({ error: errBody })
    }

    res.status(upstream.status)
    const contentType = upstream.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)

    if (req.body.stream) {
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Accel-Buffering', 'no')
      upstream.body.pipeTo(
        new WritableStream({
          write(chunk) { res.write(chunk) },
          close() { res.end() },
          abort(err) { res.destroy(err) },
        })
      )
    } else {
      const data = await upstream.json()
      res.json(data)
    }
  } catch (err) {
    console.error('[/api/chat] error:', err)
    res.status(502).json({ error: 'Upstream request failed', detail: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`[server] Express listening on http://localhost:${PORT}`)
})
