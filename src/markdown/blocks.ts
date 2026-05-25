import { md } from './parser'

export type MarkdownBlock =
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; html: string }
  | { type: 'html'; html: string }

/** 按 fence / table 切分 token，便于交给 Vue 组件渲染 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  if (!source) return []

  const tokens = md.parse(source, {})
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'fence') {
      blocks.push({
        type: 'code',
        lang: (token.info || '').trim().split(/\s+/)[0] || 'text',
        code: token.content,
      })
      i += 1
      continue
    }

    if (token.type === 'table_open') {
      let j = i
      while (j < tokens.length && tokens[j].type !== 'table_close') j += 1
      if (j < tokens.length) j += 1
      blocks.push({
        type: 'table',
        html: md.renderer.render(tokens.slice(i, j), md.options, {}),
      })
      i = j
      continue
    }

    let j = i
    while (
      j < tokens.length &&
      tokens[j].type !== 'fence' &&
      tokens[j].type !== 'table_open'
    ) {
      j += 1
    }

    if (j > i) {
      blocks.push({
        type: 'html',
        html: md.renderer.render(tokens.slice(i, j), md.options, {}),
      })
    }
    i = j
  }

  return blocks
}
