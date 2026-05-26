import { computed, unref, type MaybeRef } from 'vue'
import { linkifyCitationMarkers } from '@/utils/citationMarkup'
import { parseMarkdownBlocks } from './blocks'
import { sanitizeHtml } from './sanitize'

/** 正文 Markdown：切块 + RAG 引用 + 安全 HTML（原 MarkdownContent.vue 逻辑） */
export function useMarkdownBody(
  content: MaybeRef<string>,
  maxCitation: MaybeRef<number | undefined> = 0,
) {
  const blocks = computed(() => parseMarkdownBlocks(unref(content) || ''))

  function renderHtmlBlock(html: string) {
    const max = unref(maxCitation) ?? 0
    const withCitations = max >= 1 ? linkifyCitationMarkers(html, max) : html
    return sanitizeHtml(withCitations)
  }

  return {
    blocks,
    renderHtmlBlock,
  }
}
