import type MarkdownIt from 'markdown-it'

/** 二次封装 markdown-it 渲染规则 */
export function applyCustomRenderers(md: MarkdownIt) {
  // 代码块：fallback HTML（完整 render 路径）；主路径由 parseMarkdownBlocks + CodeBlock.vue 处理
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const lang = (token.info || '').trim().split(/\s+/)[0] || 'text'
    const escaped = md.utils.escapeHtml(token.content)
    return (
      `<div class="md-code-placeholder" data-md-lang="${lang}">` +
      `<pre class="md-code-raw"><code>${escaped}</code></pre></div>`
    )
  }

  // 表格：包裹统一容器，样式由 Table.vue / 全局 markdown 样式承接
  const defaultTableOpen = md.renderer.rules.table_open
  md.renderer.rules.table_open = (tokens, idx, options, env, slf) => {
    const inner = defaultTableOpen
      ? defaultTableOpen(tokens, idx, options, env, slf)
      : slf.renderToken(tokens, idx, options)
    return `<div class="md-table-wrapper">${inner}`
  }

  const defaultTableClose = md.renderer.rules.table_close
  md.renderer.rules.table_close = (tokens, idx, options, env, slf) => {
    const inner = defaultTableClose
      ? defaultTableClose(tokens, idx, options, env, slf)
      : slf.renderToken(tokens, idx, options)
    return `${inner}</div>`
  }

  // 链接：追加统一 class，与 Link.vue 样式一致
  const defaultLinkOpen = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, idx, options, env, slf) => {
    const token = tokens[idx]
    const idxAttr = token.attrIndex('class')
    if (idxAttr < 0) {
      token.attrPush(['class', 'md-link'])
    } else {
      const existing = token.attrs![idxAttr][1]
      token.attrs![idxAttr][1] = existing.includes('md-link') ? existing : `${existing} md-link`
    }
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, idx, options, env, slf)
      : slf.renderToken(tokens, idx, options)
  }
}
