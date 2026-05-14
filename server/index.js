import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { addDocument, listDocuments, deleteDocument, retrieveChunks } from './rag.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.SERVER_PORT || 3001
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/chat/completions'

// ---------- MCP Client ----------

let mcpClient = null
let availableTools = []

async function initMcpClient() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'mcp-server.js')],
    env: { ...process.env },
  })
  mcpClient = new McpClient({ name: 'llm-agent-client', version: '1.0.0' })
  await mcpClient.connect(transport)

  const { tools } = await mcpClient.listTools()
  availableTools = tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
  console.log('[mcp] connected, tools:', availableTools.map(t => t.function.name))
}
//调用MCP工具函数
async function callMcpTool(name, args) {
  if (!mcpClient) throw new Error('MCP client not initialized')
  return mcpClient.callTool({ name, arguments: args })
}
//初始化MCP客户端
initMcpClient().catch(err => console.error('[mcp] init failed:', err.message))

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
    let ragChunks = []  // 保存检索到的 chunks，用于后续注入前端

    // RAG 检索：把相关内容注入 system prompt
    if (ragEnabled) {
      const userMessages = llmPayload.messages.filter(m => m.role === 'user')
      const rawContent = userMessages[userMessages.length - 1]?.content || ''
      // content 可能是字符串（普通消息）或数组（多模态消息），只取文字部分做检索
      const lastUserQuery = Array.isArray(rawContent)
        ? rawContent.filter(p => p.type === 'text').map(p => p.text || '').join('\n')
        : rawContent

      if (lastUserQuery) {
        ragChunks = await retrieveChunks(lastUserQuery, apiKey)
        if (ragChunks.length > 0) {
          const context = ragChunks.map((c, i) => `[${i + 1}] (来源: ${c.docName})\n${c.text}`).join('\n\n')
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
      // 流式：RAG 找到来源时，在 LLM 流开始前注入 rag_sources 事件
      if (ragChunks.length > 0) {
        const sources = ragChunks.map(c => ({ docName: c.docName, text: c.text }))
        res.write(`data: ${JSON.stringify({ type: 'rag_sources', sources })}\n\n`)
      }
      upstream.body.pipeTo(
        new WritableStream({
          write(chunk) { res.write(chunk) },
          close() { res.end() },
          abort(err) { res.destroy(err) },
        })
      )
    } else {
      const data = await upstream.json()
      // 非流式：RAG 来源附在响应体里
      if (ragChunks.length > 0) {
        data.rag_sources = ragChunks.map(c => ({ docName: c.docName, text: c.text }))
      }
      res.json(data)
    }
  } catch (err) {
    console.error('[/api/chat] error:', err)
    res.status(502).json({ error: 'Upstream request failed', detail: err.message })
  }
})

// ---------- Agent 路由（MCP Function Calling） ----------

app.post('/api/agent', async (req, res) => {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'LLM_API_KEY is not set' })

  // 建立 SSE 连接
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = (type, data = {}) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
  }

  try {
    const { messages, model, max_tokens, temperature, top_p, top_k } = req.body
    const basePayload = { model, max_tokens, temperature, top_p, top_k }

    // 第一次调用：非流式，带工具列表，让 LLM 决定是否调用工具
    const firstRes = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...basePayload, messages, tools: availableTools, stream: false }),
    })

    if (!firstRes.ok) {
      const errBody = await firstRes.text()
      console.error(`[/api/agent] first call ${firstRes.status}:`, errBody)
      send('error', { message: errBody })
      return res.end()
    }

    const firstData = await firstRes.json()
    const choice = firstData.choices?.[0]

    let finalMessages = messages

    // LLM 决定调用工具
    if (choice?.finish_reason === 'tool_calls' && choice?.message?.tool_calls?.length) {
      const toolCalls = choice.message.tool_calls

      // 把 assistant 的 tool_calls 消息加入历史
      finalMessages = [...messages, choice.message]

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}')

        send('tool_start', { name: toolName, args: toolArgs })

        let toolResultText = ''
        try {
          const result = await callMcpTool(toolName, toolArgs)
          toolResultText = result.content?.[0]?.text || '工具执行完成'
        } catch (err) {
          toolResultText = `工具调用失败: ${err.message}`
        }

        send('tool_done', { name: toolName, result: toolResultText })

        // 把工具结果加入消息历史
        finalMessages.push({
          role: 'tool',
          content: toolResultText,
          tool_call_id: toolCall.id,
        })
      }
    }

    // 第二次调用：流式，基于工具结果生成最终回复
    const secondRes = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...basePayload, messages: finalMessages, stream: true }),
    })

    if (!secondRes.ok) {
      const errBody = await secondRes.text()
      send('error', { message: errBody })
      return res.end()
    }

    // 逐行解析 SSE，把 token 转发给前端
    const reader = secondRes.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (line === 'data: [DONE]') continue
        if (!line.startsWith('data:')) continue
        try {
          const parsed = JSON.parse(line.slice(5))
          const content = parsed.choices?.[0]?.delta?.content || ''
          const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || ''
          const usage = parsed.usage
          if (content || reasoning) {
            send('token', { content, reasoning, usage })
          }
        } catch { /* 忽略解析失败的行 */ }
      }
    }

    send('done')
    res.end()
  } catch (err) {
    console.error('[/api/agent] error:', err)
    send('error', { message: err.message })
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`[server] Express listening on http://localhost:${PORT}`)
})
