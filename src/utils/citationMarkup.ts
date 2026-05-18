/** 把正文 HTML 里的 [n] 转为可点击的引用锚点（在 <pre> 外替换，避免动到代码块） */
export function linkifyCitationMarkers(html: string, maxCitationId: number): string {
  if (!html || maxCitationId < 1) return html

  const parts = html.split(/(<pre\b[\s\S]*?<\/pre>)/gi)
  return parts
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment
      return segment.replace(/\[(\d+)\]/g, (full, digits) => {
        const n = parseInt(digits, 10)
        if (!Number.isFinite(n) || n < 1 || n > maxCitationId) return full
        return `<span class="cite-ref" tabindex="0" role="button" data-cite="${n}" title="查看来源 [${n}]">[${n}]</span>`
      })
    })
    .join('')
}
