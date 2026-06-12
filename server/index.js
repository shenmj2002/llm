import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { addDocument, listDocuments, deleteDocument, retrieveChunks } from './rag.js'
import { rewriteAnswerInlineCitations } from './citationRewrite.js'
import { generateLineChartWithSkill } from './chartSkillAdapter.js'
import { generateLocalPaperPlot, getGeneratedChartsDir } from './localChartSkill.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.SERVER_PORT || 3001
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const GENERATED_CHARTS_DIR = getGeneratedChartsDir(__dirname)

// #region debug-point A:debug-reporter
function reportDebugEvent(hypothesisId, location, msg, data = {}, runId = 'pre') {
  fetch('http://127.0.0.1:7778/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'mcp-empty-reply',
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {})
}
// #endregion

// ---------- MCP Client ----------

let mcpClient = null
let availableTools = []
const tableDraftSessions = new Map()

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

function extractToolText(result) {
  const parts = result?.content
  if (!Array.isArray(parts)) return ''
  return parts
    .map(part => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function normalizeToolResult(result) {
  const structuredResult =
    result?.structuredContent && typeof result.structuredContent === 'object'
      ? result.structuredContent
      : null

  return {
    text: extractToolText(result) || '工具执行完成',
    structuredResult,
  }
}

function isTableDraftStructuredResult(payload) {
  return payload?.kind === 'table_draft' && payload?.draft?.status === 'draft_ready'
}

function extractTextFromMessageContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function getLatestUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user') {
      return extractTextFromMessageContent(message.content).trim()
    }
  }
  return ''
}

function looksLikeObservationDataset(text = '') {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (!lines.length) return false

  const dateHeaderCount = lines.filter(line => /^\d{1,2}\.\d{1,2}(?:\s+\d{1,2}[：:]\d{2})?$/.test(line)).length
  const measurementCount = lines.filter(line => /^\d+(?:\.\d+)?%\s+/.test(line)).length

  return dateHeaderCount >= 1 && measurementCount >= 2
}

function buildAutoTableDraftArgs(rawText) {
  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const dateHeaders = lines.filter(line => /^\d{1,2}\.\d{1,2}(?:\s+\d{1,2}[：:]\d{2})?$/.test(line))
  const firstDate = dateHeaders[0] || ''
  const lastDate = dateHeaders[dateHeaders.length - 1] || ''
  const title =
    firstDate && lastDate && firstDate !== lastDate
      ? `${firstDate} 至 ${lastDate} 观测数据表`
      : firstDate
        ? `${firstDate} 观测数据表`
        : '观测数据表'

  return {
    title,
    rawText,
    description: '按原始观测数据自动解析为表格草稿，横坐标默认使用时间，纵坐标默认使用出流量。',
    chartPrompt: '请基于观测时间作为横坐标、出流量作为纵坐标生成折线图。',
    xKey: 'observedAt',
    yKey: 'outflow',
  }
}
//初始化MCP客户端
initMcpClient().catch(err => console.error('[mcp] init failed:', err.message))

app.use(express.json({ limit: '20mb' }))
app.use('/generated-charts', express.static(GENERATED_CHARTS_DIR))

app.post('/api/skills/table-to-paper-plot', async (req, res) => {
  const {
    tableDraft,
    xKey = 'observedAt',
    yKey = 'outflow',
    seriesKey = 'material',
    styleName = 'paper-line-default',
    plotSpec = {},
  } = req.body || {}

  if (!tableDraft || typeof tableDraft !== 'object') {
    return res.status(400).json({ error: 'tableDraft 缺失' })
  }

  try {
    const chart = await generateLocalPaperPlot({
      outputDirectory: GENERATED_CHARTS_DIR,
      tableDraft,
      xKey,
      yKey,
      seriesKey,
      styleName,
      plotSpec,
    })
    const origin = `${req.protocol}://${req.get('host')}`
    res.json({
      status: 'chart_ready',
      imageUrl: `${origin}${chart.relativeUrl}`,
      downloadUrl: `${origin}${chart.relativeUrl}`,
      mimeType: chart.mimeType,
      width: chart.width,
      height: chart.height,
      summary: chart.summary,
    })
  } catch (err) {
    console.error('[/api/skills/table-to-paper-plot] error:', err)
    res.status(400).json({ error: err.message || '本地论文风图表生成失败' })
  }
})

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

/** 将检索片段转为前端 citations / rag_sources（与正文 [n] 编号一致） */
function buildRagCitationPayload(chunks) {
  return chunks.map((c, i) => ({
    citationId: i + 1,
    docId: c.docId || '',
    docTitle: c.docName,
    chunkId: c.chunkId || '',
    location: { type: 'chunk', label: '检索向量片段' },
    snippet: c.text,
    docName: c.docName,
    text: c.text,
  }))
}

/** 文末自动追加的「参考资料」Markdown（含 [n]，与 citations 编号一致，供前端 linkify） */
function buildCitationAppendixMarkdown(chunks) {
  if (!chunks?.length) return ''
  const blocks = chunks.map((c, i) => {
    const preview = (c.text || '').replace(/\s+/g, ' ').trim()
    const short = preview.length > 240 ? `${preview.slice(0, 240)}…` : preview
    return `[${i + 1}] **${c.docName || '文档'}**（ID: \`${(c.chunkId || '').slice(0, 28)}${(c.chunkId || '').length > 28 ? '…' : ''}\`）\n\n> ${short || '（空片段）'}`
  })
  return `\n\n---\n\n### 参考资料\n\n${blocks.join('\n\n')}\n`
}

/** 透传 SSE、累积正文；RAG 时二次调用接口生成句内 [n]，失败则文末附录兜底 */
async function forwardStreamWithInlineCitationRewrite(upstreamRes, res, ctx) {
  const { ragChunks, apiKey, model, userQuery } = ctx

  if (!ragChunks?.length) {
    const reader = upstreamRes.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.length) res.write(Buffer.from(value))
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /**/
      }
    }
    res.end()
    return
  }

  const reader = upstreamRes.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  let aggregated = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      carry += decoder.decode(value || new Uint8Array(), { stream: !done })

      while (carry.includes('\n')) {
        const nl = carry.indexOf('\n')
        const lineBuf = carry.slice(0, nl)
        carry = carry.slice(nl + 1)

        const lineNoLF = lineBuf.replace(/\r$/, '')
        res.write(`${lineBuf}\n`)

        if (lineNoLF.startsWith('data:')) {
          const raw = lineNoLF.slice(5).trimStart()
          if (raw !== '[DONE]') {
            try {
              const j = JSON.parse(raw)
              aggregated += j.choices?.[0]?.delta?.content ?? ''
            } catch {
              /**/
            }
          }
        }
      }
      if (done) break
    }
    if (carry) res.write(carry)
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /**/
    }
  }

  const draft = aggregated.trimEnd()
  if (draft.length > 0) {
    try {
      const out = await rewriteAnswerInlineCitations({
        chatUrl: SILICONFLOW_URL,
        apiKey,
        model,
        userQuery: userQuery || '',
        ragChunks,
        assistantPlainText: draft,
      })
      if (out?.length >= 20) {
        res.write(`data: ${JSON.stringify({ type: 'answer_citations', content: out })}\n\n`)
      } else throw new Error('rewrite too short')
    } catch (err) {
      console.warn('[RAG inline citations] appendix fallback:', err?.message || err)
      const appendix = buildCitationAppendixMarkdown(ragChunks)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: appendix } }] })}\n\n`)
    }
  } else if (ragChunks.length > 0) {
    const appendix = buildCitationAppendixMarkdown(ragChunks)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: appendix } }] })}\n\n`)
  }

  res.end()
}

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'LLM_API_KEY is not set in .env' })

  try {
    let { ragEnabled, ...llmPayload } = req.body
    let ragChunks = []  // 保存检索到的 chunks，用于后续注入前端
    /** RAG / 引用重写用：上一轮用户检索查询文本（含多模态时仅 text） */
    let lastQueryForCitation = ''

    // RAG 检索：把相关内容注入 system prompt
    if (ragEnabled) {
      const userMessages = llmPayload.messages.filter(m => m.role === 'user')
      const rawContent = userMessages[userMessages.length - 1]?.content || ''
      // content 可能是字符串（普通消息）或数组（多模态消息），只取文字部分做检索
      lastQueryForCitation = Array.isArray(rawContent)
        ? rawContent.filter(p => p.type === 'text').map(p => p.text || '').join('\n')
        : rawContent

      if (lastQueryForCitation) {
        try {
          ragChunks = await retrieveChunks(lastQueryForCitation, apiKey)
          if (ragChunks.length > 0) {
            const context = ragChunks
              .map(
                (c, i) =>
                  `[${i + 1}] (文档ID: ${c.docId || '—'} | chunk: ${c.chunkId || '—'} | ${c.docName})\n${c.text}`,
              )
              .join('\n\n')
            const systemMessage = {
              role: 'system',
              content: `你是一个知识库助手。请优先依据下方「参考资料」推理并作答；资料未覆盖处可结合常识简要说明。\n\n严格要求：正文中禁止写出引用标记（不要使用 [1]、[2] 或【1】等），只输出连贯、可读的正文（可使用 Markdown）。参考资料仅帮助你组织措辞与事实。\n服务端会在完成后根据草稿与检索结果自动编排正文引用；若编排失败仅在文末附上参考资料节选。\n\n参考资料：\n${context}`,
            }
            llmPayload.messages = [systemMessage, ...llmPayload.messages]
          }
        } catch (ragError) {
          ragChunks = []
          console.warn('[/api/chat] RAG retrieve failed, fallback to plain chat:', ragError?.message || ragError)
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
        const citations = buildRagCitationPayload(ragChunks)
        res.write(`data: ${JSON.stringify({ type: 'rag_sources', sources: citations, citations })}\n\n`)
      }
      forwardStreamWithInlineCitationRewrite(upstream, res, {
        ragChunks,
        apiKey,
        model: llmPayload.model,
        userQuery: lastQueryForCitation,
      }).catch((err) => {
        console.error('[/api/chat] stream forward:', err)
        if (!res.writableEnded) res.destroy(err)
      })
    } else {
      const data = await upstream.json()
      if (ragChunks.length > 0) {
        data.rag_sources = buildRagCitationPayload(ragChunks)
        const msg = data.choices?.[0]?.message
        if (msg && typeof msg.content === 'string' && msg.content.trim()) {
          try {
            const out = await rewriteAnswerInlineCitations({
              chatUrl: SILICONFLOW_URL,
              apiKey,
              model: llmPayload.model,
              userQuery: lastQueryForCitation || '',
              ragChunks,
              assistantPlainText: msg.content.trim(),
            })
            if (out?.length >= 20) msg.content = out
            else msg.content += buildCitationAppendixMarkdown(ragChunks)
          } catch (e) {
            console.warn('[RAG inline citations]', e?.message || e)
            msg.content += buildCitationAppendixMarkdown(ragChunks)
          }
        } else if (msg && typeof msg.content === 'string') {
          msg.content += buildCitationAppendixMarkdown(ragChunks)
        }
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
    const latestUserText = getLatestUserText(messages)
    const hasObservationDataset = looksLikeObservationDataset(latestUserText)
    // #region debug-point A:agent-entry
    reportDebugEvent('A', 'server/index.js:/api/agent:entry', '[DEBUG] Agent request received', {
      model,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      latestUserTextLength: latestUserText.length,
      hasObservationDataset,
    })
    // #endregion
    const agentSystemMessage = {
      role: 'system',
      content:
        '你是一个会调用工具的数据助手。' +
        '当用户提供按日期/时间分组、且每行包含百分比材料和若干数值的原始观测数据时，必须优先调用 `generate_data_table_draft`，' +
        '把原始文本放入 rawText。' +
        '默认使用 observedAt 作为横坐标、outflow 作为纵坐标。' +
        '生成表格草稿后停止继续出图，等待用户确认。' +
        '只有当用户明确确认表格无误后，系统才会继续生成折线图。',
    }
    const agentMessages = [agentSystemMessage, ...messages]

    if (hasObservationDataset) {
      const fallbackArgs = buildAutoTableDraftArgs(latestUserText)
      // #region debug-point D:dataset-shortcut
      reportDebugEvent('D', 'server/index.js:/api/agent:dataset-shortcut', '[DEBUG] Shortcut direct table draft for observation dataset', {
        latestUserTextLength: latestUserText.length,
        title: fallbackArgs.title,
      })
      // #endregion
      send('tool_start', {
        name: 'generate_data_table_draft',
        args: fallbackArgs,
      })
      const result = await callMcpTool('generate_data_table_draft', fallbackArgs)
      const normalized = normalizeToolResult(result)
      if (isTableDraftStructuredResult(normalized.structuredResult)) {
        const draft = normalized.structuredResult.draft
        tableDraftSessions.set(draft.sessionToken, {
          ...draft,
          createdAt: Date.now(),
        })
        send('tool_done', {
          name: 'generate_data_table_draft',
          result: normalized.text,
          structuredResult: normalized.structuredResult,
        })
        send('awaiting_confirmation', {
          message: '已根据原始数据生成表格草稿，请确认无误后再生成折线图。',
        })
        // #region debug-point E:dataset-shortcut-done
        reportDebugEvent('E', 'server/index.js:/api/agent:dataset-shortcut-done', '[DEBUG] Dataset shortcut finished with awaiting confirmation', {
          sessionToken: draft.sessionToken,
          rowCount: Array.isArray(draft.rows) ? draft.rows.length : 0,
        })
        // #endregion
        send('done')
        return res.end()
      }
    }

    // 第一次调用：非流式，带工具列表，让 LLM 决定是否调用工具
    const firstRes = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ ...basePayload, messages: agentMessages, tools: availableTools, stream: false }),
    })

    if (!firstRes.ok) {
      const errBody = await firstRes.text()
      console.error(`[/api/agent] first call ${firstRes.status}:`, errBody)
      send('error', { message: errBody })
      return res.end()
    }

    const firstData = await firstRes.json()
    const choice = firstData.choices?.[0]
    // #region debug-point B:first-choice
    reportDebugEvent('B', 'server/index.js:/api/agent:first-choice', '[DEBUG] First model response received', {
      finishReason: choice?.finish_reason || '',
      toolCallCount: choice?.message?.tool_calls?.length || 0,
    })
    // #endregion

    let finalMessages = agentMessages
    let shouldAwaitConfirmation = false

    // LLM 决定调用工具
    if (choice?.finish_reason === 'tool_calls' && choice?.message?.tool_calls?.length) {
      const toolCalls = choice.message.tool_calls

      // 把 assistant 的 tool_calls 消息加入历史
      finalMessages = [...agentMessages, choice.message]

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}')
        // #region debug-point B:tool-call
        reportDebugEvent('B', 'server/index.js:/api/agent:tool-call', '[DEBUG] Tool call started', {
          toolName,
          argKeys: Object.keys(toolArgs || {}),
        })
        // #endregion

        send('tool_start', { name: toolName, args: toolArgs })

        let toolResultText = ''
        try {
          const result = await callMcpTool(toolName, toolArgs)
          const normalized = normalizeToolResult(result)
          toolResultText = normalized.text

          if (isTableDraftStructuredResult(normalized.structuredResult)) {
            const draft = normalized.structuredResult.draft
            tableDraftSessions.set(draft.sessionToken, {
              ...draft,
              createdAt: Date.now(),
            })
            shouldAwaitConfirmation = true
            // #region debug-point C:tool-draft
            reportDebugEvent('C', 'server/index.js:/api/agent:tool-draft', '[DEBUG] Table draft structured result stored', {
              sessionToken: draft.sessionToken,
              rowCount: Array.isArray(draft.rows) ? draft.rows.length : 0,
              title: draft.title || '',
            })
            // #endregion
          }

          send('tool_done', {
            name: toolName,
            result: toolResultText,
            structuredResult: normalized.structuredResult,
          })
        } catch (err) {
          toolResultText = `工具调用失败: ${err.message}`
          send('tool_done', { name: toolName, result: toolResultText })
        }

        // 把工具结果加入消息历史
        finalMessages.push({
          role: 'tool',
          content: toolResultText,
          tool_call_id: toolCall.id,
        })
      }
    }

    if (!shouldAwaitConfirmation && hasObservationDataset) {
      // #region debug-point D:fallback-enter
      reportDebugEvent('D', 'server/index.js:/api/agent:fallback-enter', '[DEBUG] Entering auto table draft fallback', {
        latestUserTextLength: latestUserText.length,
      })
      // #endregion
      send('tool_start', {
        name: 'generate_data_table_draft',
        args: buildAutoTableDraftArgs(latestUserText),
      })
      try {
        const result = await callMcpTool('generate_data_table_draft', buildAutoTableDraftArgs(latestUserText))
        const normalized = normalizeToolResult(result)
        if (isTableDraftStructuredResult(normalized.structuredResult)) {
          const draft = normalized.structuredResult.draft
          tableDraftSessions.set(draft.sessionToken, {
            ...draft,
            createdAt: Date.now(),
          })
          // #region debug-point D:fallback-draft
          reportDebugEvent('D', 'server/index.js:/api/agent:fallback-draft', '[DEBUG] Fallback table draft generated', {
            sessionToken: draft.sessionToken,
            rowCount: Array.isArray(draft.rows) ? draft.rows.length : 0,
            title: draft.title || '',
          })
          // #endregion
          send('tool_done', {
            name: 'generate_data_table_draft',
            result: normalized.text,
            structuredResult: normalized.structuredResult,
          })
          send('awaiting_confirmation', {
            message: '已根据原始数据自动生成表格草稿，请确认无误后再生成折线图。',
          })
          // #region debug-point E:fallback-awaiting
          reportDebugEvent('E', 'server/index.js:/api/agent:fallback-awaiting', '[DEBUG] Awaiting confirmation sent from fallback', {
            sessionToken: draft.sessionToken,
          })
          // #endregion
          send('done')
          return res.end()
        }
      } catch (err) {
        console.warn('[/api/agent] auto table draft fallback failed:', err?.message || err)
      }
    }

    if (shouldAwaitConfirmation) {
      send('awaiting_confirmation', {
        message: '已生成表格草稿，请确认无误后再生成折线图。',
      })
      // #region debug-point E:tool-awaiting
      reportDebugEvent('E', 'server/index.js:/api/agent:tool-awaiting', '[DEBUG] Awaiting confirmation sent after tool call', {
        finalMessageCount: finalMessages.length,
      })
      // #endregion
      send('done')
      return res.end()
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

    // #region debug-point E:stream-done
    reportDebugEvent('E', 'server/index.js:/api/agent:stream-done', '[DEBUG] Agent stream completed', {
      finalMessageCount: finalMessages.length,
      shouldAwaitConfirmation,
    })
    // #endregion
    send('done')
    res.end()
  } catch (err) {
    console.error('[/api/agent] error:', err)
    send('error', { message: err.message })
    res.end()
  }
})

app.post('/api/agent/table-chart/confirm', async (req, res) => {
  const { conversationId, messageId, sessionToken, tablePayload, chartStyleRequest, model } = req.body || {}

  if (!sessionToken || typeof sessionToken !== 'string') {
    return res.status(400).json({ error: 'sessionToken 缺失' })
  }

  const storedDraft = tableDraftSessions.get(sessionToken)
  if (!storedDraft) {
    return res.status(404).json({ error: '未找到待确认的表格草稿' })
  }

  try {
    const tableDraft =
      tablePayload && typeof tablePayload === 'object'
        ? {
            ...storedDraft,
            ...tablePayload,
            sessionToken,
          }
        : storedDraft

    const { chart, plotSpec } = await generateLineChartWithSkill({
      tableDraft,
      chartStyleRequest: typeof chartStyleRequest === 'string' ? chartStyleRequest : '',
      model: typeof model === 'string' ? model : '',
    })

    tableDraftSessions.set(sessionToken, {
      ...tableDraft,
      confirmedAt: Date.now(),
      chart,
      plotSpec,
      conversationId: conversationId || '',
      messageId: messageId || '',
    })

    res.json({
      success: true,
      chart,
      plotSpec,
      message: '折线图已生成',
    })
  } catch (err) {
    console.error('[/api/agent/table-chart/confirm] error:', err)
    res.status(502).json({ error: err.message || '折线图生成失败' })
  }
})

app.listen(PORT, () => {
  console.log(`[server] Express listening on http://localhost:${PORT}`)
})
