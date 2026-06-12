import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TABLE_TO_PAPER_PLOT_SKILL = 'table-to-paper-plot'
const DEFAULT_STYLE_NAME = 'paper-line-default'
const DEFAULT_X_KEY = 'observedAt'
const DEFAULT_Y_KEY = 'outflow'
const DEFAULT_SERIES_KEY = 'material'
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const DEFAULT_PLANNER_MODEL = process.env.CHART_PLANNER_MODEL || process.env.LLM_MODEL || 'Qwen/Qwen3-8B'
const PLOT_SPEC_TIMEOUT_MS = Number(process.env.PLOT_SPEC_TIMEOUT_MS || 12000)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SKILL_MARKDOWN_PATH = path.join(__dirname, '..', '.trae', 'skills', 'table-to-paper-plot', 'SKILL.md')
let cachedSkillMarkdown = ''

function hasTableColumn(tableDraft, key) {
  return Array.isArray(tableDraft?.columns) && tableDraft.columns.some(column => column?.key === key)
}

function resolveChartKeys(tableDraft) {
  const xKey = tableDraft?.xKey || DEFAULT_X_KEY
  const yKey = tableDraft?.yKey || DEFAULT_Y_KEY
  const seriesKey = hasTableColumn(tableDraft, DEFAULT_SERIES_KEY) ? DEFAULT_SERIES_KEY : ''
  return { xKey, yKey, seriesKey }
}

async function loadSkillMarkdown() {
  if (!cachedSkillMarkdown) {
    cachedSkillMarkdown = await fs.readFile(SKILL_MARKDOWN_PATH, 'utf8')
  }
  return cachedSkillMarkdown
}

function extractJson(text = '') {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('模型未返回 plotSpec')
  try {
    return JSON.parse(trimmed)
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('模型返回中未找到有效 JSON')
  return JSON.parse(match[0])
}

function sanitizePlotSpec(rawSpec, tableDraft) {
  const { xKey: defaultXKey, yKey: defaultYKey, seriesKey: defaultSeriesKey } = resolveChartKeys(tableDraft)
  const columns = Array.isArray(tableDraft?.columns) ? tableDraft.columns : []
  const columnKeys = new Set(columns.map(column => column.key))
  const xKey = columnKeys.has(rawSpec?.xKey) ? rawSpec.xKey : defaultXKey
  const yKey = columnKeys.has(rawSpec?.yKey) ? rawSpec.yKey : defaultYKey
  const seriesKey = rawSpec?.seriesKey && columnKeys.has(rawSpec.seriesKey) ? rawSpec.seriesKey : defaultSeriesKey

  return {
    chartType: 'line',
    styleName: typeof rawSpec?.styleName === 'string' && rawSpec.styleName.trim() ? rawSpec.styleName.trim() : DEFAULT_STYLE_NAME,
    title: typeof rawSpec?.title === 'string' && rawSpec.title.trim() ? rawSpec.title.trim() : tableDraft?.title || '折线图',
    xKey,
    yKey,
    seriesKey,
    xLabel: typeof rawSpec?.xLabel === 'string' && rawSpec.xLabel.trim() ? rawSpec.xLabel.trim() : '',
    yLabel: typeof rawSpec?.yLabel === 'string' && rawSpec.yLabel.trim() ? rawSpec.yLabel.trim() : '',
    showLegend: rawSpec?.showLegend === true,
    annotateSeries: rawSpec?.annotateSeries !== false,
    zeroReferenceLine: rawSpec?.zeroReferenceLine !== false,
    summary: typeof rawSpec?.summary === 'string' ? rawSpec.summary.trim() : '',
  }
}

function getDefaultPlotSpec(tableDraft) {
  const { xKey, yKey, seriesKey } = resolveChartKeys(tableDraft)
  return sanitizePlotSpec({
    styleName: DEFAULT_STYLE_NAME,
    title: tableDraft?.title || '折线图',
    xKey,
    yKey,
    seriesKey,
    showLegend: false,
    annotateSeries: true,
    zeroReferenceLine: true,
    summary: '已按默认论文风样式生成折线图',
  }, tableDraft)
}

function resolvePlannerModel(model = '') {
  const requestedModel = typeof model === 'string' ? model.trim() : ''
  if (!requestedModel) return DEFAULT_PLANNER_MODEL

  // DeepSeek-R1 更适合长推理，当前在 plotSpec 规划场景中容易拖慢甚至卡住确认链路。
  if (/deepseek-ai\/DeepSeek-R1/i.test(requestedModel)) {
    return DEFAULT_PLANNER_MODEL
  }

  return requestedModel
}

async function generatePlotSpecWithModel({ tableDraft, chartStyleRequest = '', model = '' }) {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error('LLM_API_KEY 未配置，无法调用模型生成 plotSpec')
  }

  const skillMarkdown = await loadSkillMarkdown()
  const plannerModel = resolvePlannerModel(model)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PLOT_SPEC_TIMEOUT_MS)
  let response

  try {
    response = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: plannerModel,
        temperature: 0.2,
        max_tokens: 1200,
        stream: false,
        messages: [
          {
            role: 'system',
            content: [
              '你是一个绘图规划器，不直接生成图片。',
              '你必须严格参考给定的 skill 规范和表格数据，输出一份 JSON 格式的 plotSpec。',
              '只允许输出 JSON 对象，不要输出 markdown、解释文字或代码块。',
              'chartType 固定为 "line"。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              '以下是 skill 规范：',
              skillMarkdown,
              '',
              '以下是用户已确认的表格数据：',
              JSON.stringify(tableDraft, null, 2),
              '',
              `用户补充样式要求：${chartStyleRequest || '无，按默认论文风样式处理'}`,
              '',
              '请输出一个 JSON 对象，字段仅限：',
              'styleName, title, xKey, yKey, seriesKey, xLabel, yLabel, showLegend, annotateSeries, zeroReferenceLine, summary',
              '如果无法判断，也要给出合理默认值。',
            ].join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`模型生成 plotSpec 超时（>${PLOT_SPEC_TIMEOUT_MS}ms）`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`模型生成 plotSpec 失败: ${response.status} ${errText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''
  return sanitizePlotSpec(extractJson(content), tableDraft)
}

function buildSkillRequestPayload({ tableDraft, chartStyleRequest = '', plotSpec }) {
  const effectiveSpec = plotSpec || getDefaultPlotSpec(tableDraft)
  return {
    skillName: TABLE_TO_PAPER_PLOT_SKILL,
    tableDraft,
    xKey: effectiveSpec.xKey,
    yKey: effectiveSpec.yKey,
    seriesKey: effectiveSpec.seriesKey || undefined,
    styleName: effectiveSpec.styleName || DEFAULT_STYLE_NAME,
    chartStyleRequest,
    styleRequest: chartStyleRequest,
    chartPrompt: tableDraft?.chartPrompt || '',
    plotSpec: effectiveSpec,
    // legacy fields: keep these for backward compatibility with the current HTTP chart service
    type: 'line_chart',
  }
}

function normalizeChartSkillResponse(data) {
  const payload = data?.chart || data
  const imageUrl =
    payload?.imageUrl ||
    payload?.image_url ||
    payload?.result?.imageUrl ||
    payload?.result?.image_url ||
    ''

  const downloadUrl =
    payload?.downloadUrl ||
    payload?.download_url ||
    payload?.result?.downloadUrl ||
    payload?.result?.download_url ||
    imageUrl

  if (!imageUrl) {
    throw new Error('折线图 Skill 未返回 imageUrl')
  }

  return {
    status: 'chart_ready',
    imageUrl,
    downloadUrl,
    mimeType: payload?.mimeType || payload?.mime_type || payload?.result?.mimeType || 'image/png',
    width: payload?.width || payload?.result?.width,
    height: payload?.height || payload?.result?.height,
    summary: payload?.summary || payload?.result?.summary || '',
  }
}

export async function generateLineChartWithSkill({ tableDraft, chartStyleRequest = '', model = '' }) {
  const serverPort = process.env.SERVER_PORT || 3001
  const skillUrl = process.env.CHART_SKILL_URL || `http://127.0.0.1:${serverPort}/api/skills/table-to-paper-plot`
  let plotSpec
  try {
    plotSpec = await generatePlotSpecWithModel({ tableDraft, chartStyleRequest, model })
  } catch {
    plotSpec = getDefaultPlotSpec(tableDraft)
  }

  const requestPayload = buildSkillRequestPayload({ tableDraft, chartStyleRequest, plotSpec })

  const response = await fetch(skillUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`折线图 Skill 调用失败: ${response.status} ${errText}`)
  }

  const data = await response.json()
  return {
    chart: normalizeChartSkillResponse(data),
    plotSpec,
  }
}
