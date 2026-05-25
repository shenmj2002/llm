import { ref, watch, onUnmounted, type Ref } from 'vue'

export interface UseStreamingMarkdownOptions {
  /** 两次 Markdown 解析之间的最小间隔（毫秒） */
  throttleMs?: number
}

/**
 * 流式 Markdown：缓冲区 + 节流解析
 *
 * stream → buffer → throttle → 输出给 Markdown 解析
 *
 * - 流式中：最多每 throttleMs 更新一次 displayContent，减少 parseMarkdownBlocks / md.render 次数
 * - 流式结束：立即 flush，保证最终内容完整
 */
export function useStreamingMarkdown(
  source: Ref<string>,
  streaming: Ref<boolean>,
  options: UseStreamingMarkdownOptions = {},
) {
  const throttleMs = options.throttleMs ?? 50

  /** 当前累积的原始 Markdown（buffer） */
  const buffer = ref('')
  /** 节流后交给解析器的文本 */
  const displayContent = ref('')

  let lastRender = 0
  let throttleTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  }

  function flush() {
    clearTimer()
    buffer.value = source.value
    displayContent.value = buffer.value
    lastRender = Date.now()
  }

  /** 收到新 chunk：写入 buffer，按节流策略决定是否解析 */
  function scheduleRender() {
    buffer.value = source.value

    // 流式结束：立刻解析最终 buffer
    if (!streaming.value) {
      flush()
      return
    }

    const now = Date.now()
    const elapsed = now - lastRender

    // 距上次解析已超过阈值：立即解析
    if (elapsed >= throttleMs) {
      displayContent.value = buffer.value
      lastRender = now
      return
    }

    // 否则预约一次 trailing 解析，避免长时间不更新
    if (throttleTimer) return
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      displayContent.value = buffer.value
      lastRender = Date.now()
    }, throttleMs - elapsed)
  }

  watch(source, scheduleRender, { immediate: true })
  watch(streaming, (isStreaming) => {
    if (!isStreaming) flush()
  })

  onUnmounted(clearTimer)

  return {
    buffer,
    displayContent,
    flush,
  }
}
