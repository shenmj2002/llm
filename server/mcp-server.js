import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'llm-agent-server',
  version: '1.0.0',
})

// #region debug-point C:debug-reporter
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

function normalizeLine(line) {
  return line
    .replace(/：/g, ':')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
}

function isDateHeaderLine(line) {
  const normalized = normalizeLine(line)
  return /^\d{1,2}\.\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(normalized)
}

function parseDateHeader(line) {
  const normalized = normalizeLine(line)
  const [date, time = ''] = normalized.split(/\s+/)
  return {
    date,
    time,
    observedAt: time ? `${date} ${time}` : date,
  }
}

function parseMeasurementLine(line) {
  const normalized = normalizeLine(line)
  const materialMatch = normalized.match(/^(\d+(?:\.\d+)?)%/)
  if (!materialMatch) return null

  const material = `${materialMatch[1]}%`
  const numericTokens = normalized.match(/-?\d+(?:\.\d+)?/g) || []
  if (numericTokens.length < 3) return null

  const valueTokens = numericTokens.slice(1).map(Number)
  if (valueTokens.length < 2) return null

  const inflow = valueTokens[0]
  const increment = valueTokens.length >= 3 ? valueTokens[1] : 0
  const outflow = valueTokens.length >= 3 ? valueTokens[2] : valueTokens[1]

  return {
    material,
    inflow,
    increment,
    outflow,
  }
}

function buildDraftFromRawText({ rawText, title, description, chartPrompt }) {
  const lines = rawText
    .split('\n')
    .map(line => normalizeLine(line))
    .filter(Boolean)
  // #region debug-point C:parse-start
  reportDebugEvent('C', 'server/mcp-server.js:buildDraftFromRawText:start', '[DEBUG] Start parsing raw dataset', {
    title,
    lineCount: lines.length,
  })
  // #endregion

  const rows = []
  let currentHeader = null

  for (const line of lines) {
    if (isDateHeaderLine(line)) {
      currentHeader = parseDateHeader(line)
      continue
    }

    const measurement = parseMeasurementLine(line)
    if (!measurement) continue
    if (!currentHeader) {
      throw new Error(`检测到数据行但缺少日期头: ${line}`)
    }

    rows.push({
      id: `row_${rows.length + 1}`,
      cells: {
        observedAt: currentHeader.observedAt,
        date: currentHeader.date,
        time: currentHeader.time || '',
        material: measurement.material,
        inflow: measurement.inflow,
        increment: measurement.increment,
        outflow: measurement.outflow,
      },
    })
  }

  if (rows.length === 0) {
    // #region debug-point C:parse-empty
    reportDebugEvent('C', 'server/mcp-server.js:buildDraftFromRawText:empty', '[DEBUG] No rows parsed from raw dataset', {
      title,
    })
    // #endregion
    throw new Error('未能从原始文本中解析出有效表格数据')
  }

  const sessionToken = `table_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  // #region debug-point C:parse-done
  reportDebugEvent('C', 'server/mcp-server.js:buildDraftFromRawText:done', '[DEBUG] Raw dataset parsed into draft', {
    title,
    rowCount: rows.length,
    firstObservedAt: rows[0]?.cells?.observedAt || '',
    lastObservedAt: rows[rows.length - 1]?.cells?.observedAt || '',
  })
  // #endregion
  return {
    status: 'draft_ready',
    title,
    description:
      description || '按“日期/时间 + 渗透材料 + 入流量 + 下一次增量 + 出流量”解析；缺失增量时默认按 0 处理。',
    columns: [
      { key: 'observedAt', label: '观测时间', align: 'left' },
      { key: 'material', label: '渗透材料', align: 'center' },
      { key: 'inflow', label: '入流量', align: 'right' },
      { key: 'increment', label: '下一次增量', align: 'right' },
      { key: 'outflow', label: '出流量', align: 'right' },
    ],
    rows,
    editable: true,
    canConfirm: true,
    chartPending: true,
    sessionToken,
    chartPrompt: chartPrompt || '',
    xKey: 'observedAt',
    yKey: 'outflow',
  }
}

// 工具 1: 获取当前时间
server.registerTool(
  'get_current_time',
  {
    description: '获取当前系统时间，当用户询问现在几点、今天日期等时间相关问题时使用',
  },
  async () => {
    const now = new Date()
    return {
      content: [{
        type: 'text',
        text: `当前时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      }],
    }
  }
)

server.registerTool(
  'generate_data_table_draft',
  {
    description: '当用户需要先生成结构化数据表格，并在确认无误后再继续生成折线图时使用。此工具只负责生成表格草稿，不负责出图。',
    inputSchema: {
      title: z.string().describe('表格标题'),
      rawText: z.string().optional().describe('原始观测文本，支持按日期分组的半结构化输入，例如“12.12 + 2% 70 48.286”这种格式'),
      description: z.string().optional().describe('表格说明或摘要'),
      columns: z.array(
        z.object({
          key: z.string().describe('列 key'),
          label: z.string().describe('列标题'),
          align: z.enum(['left', 'center', 'right']).optional().describe('对齐方式'),
        })
      ).optional().describe('已结构化的表格列定义'),
      rows: z.array(
        z.object({
          id: z.string().optional().describe('行 ID'),
          cells: z.record(z.union([z.string(), z.number(), z.null()])).describe('按列 key 存放的单元格值'),
        })
      ).optional().describe('已结构化的表格行数据'),
      chartPrompt: z.string().optional().describe('后续生成折线图时可复用的图像提示词'),
      xKey: z.string().optional().describe('折线图 x 轴对应列 key'),
      yKey: z.string().optional().describe('折线图 y 轴对应列 key'),
    },
  },
  async ({ title, rawText, description, columns, rows, chartPrompt, xKey, yKey }) => {
    let draft
    if (rawText?.trim()) {
      draft = buildDraftFromRawText({
        rawText,
        title,
        description,
        chartPrompt,
      })
    } else {
      if (!columns?.length || !rows?.length) {
        throw new Error('rawText 或 columns + rows 至少需要提供一种')
      }
      const sessionToken = `table_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      draft = {
        status: 'draft_ready',
        title,
        description: description || '',
        columns,
        rows: rows.map((row, index) => ({
          id: row.id || `row_${index + 1}`,
          cells: row.cells,
        })),
        editable: true,
        canConfirm: true,
        chartPending: true,
        sessionToken,
        chartPrompt: chartPrompt || '',
        xKey: xKey || columns[0]?.key || '',
        yKey: yKey || columns[1]?.key || columns[0]?.key || '',
      }
    }

    return {
      content: [{
        type: 'text',
        text: `已生成表格草稿《${title}》，等待用户确认后再生成折线图。`,
      }],
      structuredContent: {
        kind: 'table_draft',
        draft,
      },
    }
  }
)

// 启动 MCP Server（stdio 传输）
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[mcp-server] running on stdio')
