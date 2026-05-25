import MarkdownIt from 'markdown-it'
import mdLinkAttributes from 'markdown-it-link-attributes'
import { full as emoji } from 'markdown-it-emoji'
import { applyCustomRenderers } from './renderer'

/** 统一 Markdown 解析实例 */
export const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

md.use(mdLinkAttributes, {
  attrs: {
    target: '_blank',
    rel: 'noopener noreferrer',
  },
})

md.use(emoji)
applyCustomRenderers(md)

export default md
