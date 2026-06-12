import fs from 'node:fs/promises'
import path from 'node:path'

const OUTPUT_DIR_NAME = 'generated-charts'
const DEFAULT_STYLE_NAME = 'paper-line-default'
const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 560

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function toNumeric(value) {
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function buildColumnLabelMap(columns = []) {
  return new Map(columns.map(column => [column.key, column.label || column.key]))
}

function resolveChartDataset({ tableDraft, xKey, yKey, seriesKey, plotSpec = {} }) {
  const columnLabelMap = buildColumnLabelMap(tableDraft?.columns || [])
  const rows = Array.isArray(tableDraft?.rows) ? tableDraft.rows : []

  if (!rows.length) {
    throw new Error('表格中没有可用于出图的数据行')
  }

  const xLabels = []
  const xSet = new Set()
  const seriesMap = new Map()

  for (const row of rows) {
    const cells = row?.cells || {}
    const rawX = cells[xKey]
    const rawY = toNumeric(cells[yKey])
    if (rawX == null || rawY == null) continue
    const xLabel = String(rawX)
    if (!xSet.has(xLabel)) {
      xSet.add(xLabel)
      xLabels.push(xLabel)
    }

    const seriesName = seriesKey && cells[seriesKey] != null ? String(cells[seriesKey]) : '数据'
    if (!seriesMap.has(seriesName)) {
      seriesMap.set(seriesName, new Map())
    }
    seriesMap.get(seriesName).set(xLabel, rawY)
  }

  const series = [...seriesMap.entries()].map(([name, values]) => ({
    name,
    values: xLabels.map(label => values.get(label)),
  }))

  if (!series.length || !xLabels.length) {
    throw new Error('未解析出有效的横纵坐标数据')
  }

  return {
    title: plotSpec?.title || tableDraft?.title || '折线图',
    xLabel: plotSpec?.xLabel || columnLabelMap.get(xKey) || xKey,
    yLabel: plotSpec?.yLabel || columnLabelMap.get(yKey) || yKey,
    xLabels,
    series,
    showLegend: plotSpec?.showLegend === true,
    annotateSeries: plotSpec?.annotateSeries !== false,
    zeroReferenceLine: plotSpec?.zeroReferenceLine !== false,
  }
}

function computeYDomain(series) {
  const values = series.flatMap(item => item.values).filter(isFiniteNumber)
  if (!values.length) {
    throw new Error('纵坐标数据为空，无法生成图表')
  }

  let min = Math.min(...values, 0)
  let max = Math.max(...values, 0)
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.15, 1)
    min -= padding
    max += padding
  } else {
    const padding = Math.max((max - min) * 0.12, 1)
    min -= padding
    max += padding
  }
  return { min, max }
}

function createScale(domainMin, domainMax, rangeMin, rangeMax) {
  const domainSpan = domainMax - domainMin || 1
  const rangeSpan = rangeMax - rangeMin
  return value => rangeMin + ((value - domainMin) / domainSpan) * rangeSpan
}

function generateTicks(min, max, count = 6) {
  const span = max - min || 1
  const rawStep = span / count
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rawStep) || 1))
  const residual = rawStep / magnitude
  let niceResidual = 1
  if (residual >= 5) niceResidual = 5
  else if (residual >= 2) niceResidual = 2
  const step = niceResidual * magnitude
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks = []
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)))
  }
  return ticks
}

function formatTick(value) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function getSeriesStyle(index) {
  const palette = [
    { stroke: '#1677d8', marker: 'circle' },
    { stroke: '#f04452', marker: 'square' },
    { stroke: '#2a9d5b', marker: 'triangle' },
    { stroke: '#7c4dff', marker: 'diamond' },
  ]
  return palette[index % palette.length]
}

function renderMarker({ marker, cx, cy, color }) {
  if (marker === 'square') {
    return `<rect x="${(cx - 4).toFixed(2)}" y="${(cy - 4).toFixed(2)}" width="8" height="8" fill="${color}" />`
  }
  if (marker === 'triangle') {
    return `<polygon points="${cx.toFixed(2)},${(cy - 5).toFixed(2)} ${(cx - 5).toFixed(2)},${(cy + 4).toFixed(2)} ${(cx + 5).toFixed(2)},${(cy + 4).toFixed(2)}" fill="${color}" />`
  }
  if (marker === 'diamond') {
    return `<polygon points="${cx.toFixed(2)},${(cy - 5).toFixed(2)} ${(cx - 5).toFixed(2)},${cy.toFixed(2)} ${cx.toFixed(2)},${(cy + 5).toFixed(2)} ${(cx + 5).toFixed(2)},${cy.toFixed(2)}" fill="${color}" />`
  }
  return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="4.5" fill="${color}" />`
}

function renderPaperLineSvg(dataset) {
  const width = DEFAULT_WIDTH
  const height = DEFAULT_HEIGHT
  const margin = { top: 54, right: 120, bottom: 88, left: 88 }
  const plotLeft = margin.left
  const plotRight = width - margin.right
  const plotTop = margin.top
  const plotBottom = height - margin.bottom
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const { min, max } = computeYDomain(dataset.series)
  const yScale = createScale(min, max, plotBottom, plotTop)
  const xStep = dataset.xLabels.length > 1 ? plotWidth / (dataset.xLabels.length - 1) : 0
  const xPosition = index => plotLeft + xStep * index
  const yTicks = generateTicks(min, max)
  const zeroY = yScale(0)
  const rotateTicks = dataset.xLabels.length >= 6

  const axis = [
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#151515" stroke-width="1.6" />`,
    ...yTicks.map(value => {
      const y = yScale(value)
      return [
        `<line x1="${plotLeft}" x2="${plotLeft - 8}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#151515" stroke-width="1.2" />`,
        `<text x="${plotLeft - 14}" y="${(y + 5).toFixed(2)}" text-anchor="end" font-size="13" fill="#1d1d1d">${escapeXml(formatTick(value))}</text>`,
      ].join('')
    }).join(''),
    ...dataset.xLabels.map((label, index) => {
      const x = xPosition(index)
      const tickLine = `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${plotBottom}" y2="${plotBottom + 8}" stroke="#151515" stroke-width="1.2" />`
      const text = rotateTicks
        ? `<text x="${x.toFixed(2)}" y="${(plotBottom + 24).toFixed(2)}" transform="rotate(28 ${x.toFixed(2)} ${(plotBottom + 24).toFixed(2)})" text-anchor="start" font-size="12" fill="#1d1d1d">${escapeXml(label)}</text>`
        : `<text x="${x.toFixed(2)}" y="${(plotBottom + 26).toFixed(2)}" text-anchor="middle" font-size="12" fill="#1d1d1d">${escapeXml(label)}</text>`
      return `${tickLine}${text}`
    }).join(''),
    `<text x="${(plotLeft + plotWidth / 2).toFixed(2)}" y="${height - 26}" text-anchor="middle" font-size="15" fill="#1d1d1d">${escapeXml(dataset.xLabel)}</text>`,
    `<text x="24" y="${(plotTop + plotHeight / 2).toFixed(2)}" transform="rotate(-90 24 ${(plotTop + plotHeight / 2).toFixed(2)})" text-anchor="middle" font-size="15" fill="#1d1d1d">${escapeXml(dataset.yLabel)}</text>`,
  ].join('')

  const zeroLine =
    dataset.zeroReferenceLine && zeroY >= plotTop && zeroY <= plotBottom
      ? `<line x1="${plotLeft}" x2="${plotRight}" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}" stroke="#8a8a8a" stroke-width="1.2" stroke-dasharray="5 5" />`
      : ''

  const seriesMarkup = dataset.series.map((item, index) => {
    const style = getSeriesStyle(index)
    const points = item.values
      .map((value, pointIndex) => {
        if (!isFiniteNumber(value)) return null
        return {
          x: xPosition(pointIndex),
          y: yScale(value),
        }
      })
      .filter(Boolean)

    if (!points.length) return ''

    const polyline = `<polyline fill="none" stroke="${style.stroke}" stroke-width="2.2" points="${points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}" />`
    const markers = points
      .map(point => renderMarker({ marker: style.marker, cx: point.x, cy: point.y, color: style.stroke }))
      .join('')
    const lastPoint = points[points.length - 1]
    const labelY = Math.max(plotTop + 18, Math.min(plotBottom - 8, lastPoint.y - 12))
    const label = dataset.annotateSeries
      ? `<text x="${(Math.min(plotRight - 6, lastPoint.x + 12)).toFixed(2)}" y="${labelY.toFixed(2)}" font-size="14" fill="#1d1d1d">${escapeXml(item.name)}</text>`
      : ''
    return `${polyline}${markers}${label}`
  }).join('')

  const legend = dataset.showLegend
    ? dataset.series.map((item, index) => {
        const style = getSeriesStyle(index)
        const legendX = plotRight + 18
        const legendY = plotTop + 20 + index * 24
        const marker = renderMarker({ marker: style.marker, cx: legendX + 8, cy: legendY - 4, color: style.stroke })
        return [
          `<line x1="${legendX}" x2="${legendX + 18}" y1="${(legendY - 4).toFixed(2)}" y2="${(legendY - 4).toFixed(2)}" stroke="${style.stroke}" stroke-width="2.2" />`,
          marker,
          `<text x="${legendX + 26}" y="${legendY.toFixed(2)}" font-size="13" fill="#1d1d1d">${escapeXml(item.name)}</text>`,
        ].join('')
      }).join('')
    : ''

  const title = dataset.title
    ? `<text x="${(plotLeft + plotWidth / 2).toFixed(2)}" y="28" text-anchor="middle" font-size="18" fill="#1d1d1d">${escapeXml(dataset.title)}</text>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  ${title}
  ${axis}
  ${zeroLine}
  ${seriesMarkup}
  ${legend}
</svg>`
}

export async function generateLocalPaperPlot({
  outputDirectory,
  tableDraft,
  xKey,
  yKey,
  seriesKey,
  styleName = DEFAULT_STYLE_NAME,
  plotSpec = {},
}) {
  const dataset = resolveChartDataset({ tableDraft, xKey, yKey, seriesKey, plotSpec })
  const svg = renderPaperLineSvg(dataset)
  const fileName = `chart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.svg`
  await fs.mkdir(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, fileName)
  await fs.writeFile(outputPath, svg, 'utf8')

  return {
    fileName,
    relativeUrl: `/${OUTPUT_DIR_NAME}/${fileName}`,
    mimeType: 'image/svg+xml',
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    summary: styleName === DEFAULT_STYLE_NAME
      ? '已按默认论文风样式生成折线图'
      : `已按 ${styleName} 样式生成折线图`,
  }
}

export function getGeneratedChartsDir(serverDir) {
  return path.join(serverDir, OUTPUT_DIR_NAME)
}
