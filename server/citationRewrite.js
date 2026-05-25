/**
 * 对已生成的主模型正文做「离线」引用插入：不改变事实判断，仅在可对应资料的位置加入 [n]。
 * 通过第二次 chat/completions（非流式）实现，需在业务层控制成本和延迟。
 * ragChunks 与 rag_sources / 上下文编号一致：[1]→chunks[0] …
 *
 * 下列常量可调：输入片段截断长度、输出 max_tokens 上下限（仍以所选 SiliconFlow 模型为准）。
 */
// 每条资料片段送进二次模型的最大字符数（顶满时请换更大上下文的型号或再调低 TOP_K）
const SOURCE_CLIP_CHARS = 12000

/** 输出侧：按草稿长度预估 max_tokens；上限取较大以便长文也能完整回填 [n]，仍受所选模型上下文约束 */
const OUTPUT_MAX_TOKENS_CAP = 16384
const OUTPUT_MAX_TOKENS_FLOOR = 2048
const OUTPUT_LENGTH_HEADROOM_TOKENS = 4096

export async function rewriteAnswerInlineCitations({
  chatUrl,
  apiKey,
  model,
  userQuery,
  ragChunks,
  assistantPlainText,
}) {
  const clip = (s, max = SOURCE_CLIP_CHARS) => {
    const t = s || ''
    return t.length > max ? `${t.slice(0, max)}\n…（已截断）` : t
  }

  const sourcesBlock = ragChunks
    .map(
      (c, i) =>
        `[${i + 1}] （文档：${c.docName || '—'}｜chunk: ${String(c.chunkId || '—').slice(0, 36)}）\n${clip(c.text)}`,
    )
    .join('\n\n---\n\n')

  const userPrompt = [
    '## 任务',
    '下面依次给出：用户问题、按编号排列的资料片段、以及助手已经写好但不含角标引用（无 [n]）的答案草稿。',
    '请重写该草稿为 Markdown：**仅当某句或小节可被下面某条参考资料直接支持时**，在句号、分句末或短语后附上相应半角引用标记 **[n]**（可多标如 **[1][2]**）。编号必须与资料前缀 [1][2] 一致。',
    '— 禁止使用全角【】括号做引用。',
    '— 不要大段抄写资料正文；措辞尽量保持草稿一致，不要新增草稿中没有的结论。',
    '— 不要输出前言、致谢或单独的「参考资料」列表；只输出带引用的正文。',
    '',
    '## 用户问题',
    (userQuery || '').trim() || '（略）',
    '',
    '## 资料片段',
    sourcesBlock,
    '',
    '## 答案草稿（无引用标记）',
    assistantPlainText,
    '',
    '请直接输出重写后的 Markdown 正文：',
  ].join('\n')

  // 粗估：中英文混排约 2 字符 ≈ 1 token；加一点余量承接插入的 [n]
  const estimated = Math.ceil(assistantPlainText.length / 2) + OUTPUT_LENGTH_HEADROOM_TOKENS

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.08,
      max_tokens: Math.min(
        Math.max(estimated, OUTPUT_MAX_TOKENS_FLOOR),
        OUTPUT_MAX_TOKENS_CAP,
      ),
      messages: [
        {
          role: 'system',
          content:
            '你是引用标注编辑器：在用户给定草稿上按需插入英文半角格式的 [编号]；不要编造无法在资料中找到依据的陈述。',
        },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`citation rewrite HTTP ${res.status}: ${t.slice(0, 500)}`)
  }

  const data = await res.json()
  const out = data?.choices?.[0]?.message?.content
  return typeof out === 'string' ? out.trim() : ''
}
