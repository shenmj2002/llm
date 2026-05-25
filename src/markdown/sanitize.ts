import DOMPurify from 'dompurify'

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'data-cite', 'tabindex', 'role', 'title', 'data-md-lang'],
  ADD_TAGS: ['span'],
}

/** XSS 防护：渲染后过滤危险 HTML */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string
}
