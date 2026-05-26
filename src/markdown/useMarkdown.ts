import { md } from './parser'
import { parseMarkdownBlocks } from './blocks'
import { sanitizeHtml } from './sanitize'

export { useStreamingMarkdown } from './useStreamingMarkdown'
export type { UseStreamingMarkdownOptions } from './useStreamingMarkdown'
export { useMarkdownBody } from './useMarkdownBody'

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
