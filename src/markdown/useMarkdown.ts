import { md } from './parser'
import { parseMarkdownBlocks } from './blocks'
import { sanitizeHtml } from './sanitize'

/** 统一 Markdown 解析能力 */
export function useMarkdown() {
  const renderMarkdown = (text: string) => {
    if (!text) return ''
    return sanitizeHtml(md.render(text))
  }

  return {
    renderMarkdown,
    parseMarkdownBlocks,
    sanitizeHtml,
  }
}
