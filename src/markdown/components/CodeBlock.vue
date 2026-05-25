<script setup lang="ts">
import { computed, ref } from 'vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import copyIcon from '@/assets/photo/复制.png'

const props = defineProps<{
  code: string
  lang?: string
}>()

const copied = ref(false)

const language = computed(() => {
  const lang = (props.lang || 'text').trim()
  return lang || 'text'
})

const highlightedHtml = computed(() => {
  const raw = props.code ?? ''
  const lang = language.value
  if (lang && lang !== 'text' && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* fallback below */
    }
  }
  return hljs.highlightAuto(raw).value
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.code ?? '')
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div class="code-block">
    <div class="code-header">
      <span class="code-lang">{{ language }}</span>
      <button
        type="button"
        class="code-action-btn"
        :title="copied ? '已复制' : '复制'"
        @click="handleCopy"
      >
        <img :src="copyIcon" alt="copy" />
      </button>
    </div>
    <pre class="hljs"><code v-html="highlightedHtml" /></pre>
  </div>
</template>

<style scoped lang="scss">
.code-block {
  margin: 0.5rem 0;
  border: 1px solid var(--code-border, #e2e8f0);
  border-radius: 0.5rem;
  overflow: hidden;
  width: 100%;

  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    background-color: var(--code-header-bg, #282c34);

    .code-lang {
      font-size: 0.875rem;
      color: var(--code-lang-text, #abb2bf);
      font-family: var(--code-font-family, ui-monospace, monospace);
    }

    .code-action-btn {
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s;

      img {
        width: 1rem;
        height: 1rem;
      }

      &:hover {
        background-color: var(--code-header-button-hover-bg, rgba(255, 255, 255, 0.1));
      }
    }
  }

  .hljs {
    margin: 0 !important;
    padding: 1rem;
    background-color: var(--code-block-bg, #282c34);
    overflow-x: auto;
    white-space: pre;

    code {
      white-space: pre;
    }
  }
}
</style>
