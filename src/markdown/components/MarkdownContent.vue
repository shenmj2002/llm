<script setup lang="ts">
import { computed } from 'vue'
import { linkifyCitationMarkers } from '@/utils/citationMarkup'
import { parseMarkdownBlocks } from '../blocks'
import { sanitizeHtml } from '../sanitize'
import CodeBlock from './CodeBlock.vue'
import Table from './Table.vue'

const props = defineProps<{
  content: string
  maxCitation?: number
}>()

const blocks = computed(() => parseMarkdownBlocks(props.content || ''))

function renderHtmlBlock(html: string) {
  const withCitations =
    (props.maxCitation ?? 0) >= 1
      ? linkifyCitationMarkers(html, props.maxCitation!)
      : html
  return sanitizeHtml(withCitations)
}
</script>

<template>
  <div class="markdown-body">
    <template v-for="(block, index) in blocks" :key="index">
      <CodeBlock
        v-if="block.type === 'code'"
        :lang="block.lang"
        :code="block.code"
      />
      <Table
        v-else-if="block.type === 'table'"
        :html="renderHtmlBlock(block.html)"
      />
      <div
        v-else
        class="markdown-html"
        v-html="renderHtmlBlock(block.html)"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.markdown-body {
  width: 100%;

  .markdown-html {
    :deep(p) {
      margin: 0;
    }

    :deep(p + p) {
      margin-bottom: 0.5rem;
    }

    :deep(code:not(.hljs *):not([class*='language-'])) {
      font-family: var(--code-font-family, ui-monospace, monospace);
      padding: 0.2em 0.4em;
      border-radius: 0.25rem;
      background-color: #f0f0f0;
    }

    :deep(ul),
    :deep(ol) {
      margin: 0.5rem 0;
      padding-left: 1.5rem;
    }

    :deep(blockquote) {
      margin: 0.5rem 0;
      padding-left: 1rem;
      border-left: 4px solid var(--border-color, #e2e8f0);
      color: var(--text-color-secondary, #64748b);
    }

    :deep(a),
    :deep(.md-link) {
      color: #3f7af1;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    :deep(img) {
      max-width: 100%;
      border-radius: 0.5rem;
    }

    :deep(.cite-ref) {
      cursor: pointer;
      color: var(--primary-color, #3b82f6);
      font-weight: 600;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }

    :deep(.cite-ref:focus) {
      outline: 2px solid var(--primary-color, #93c5fd);
      outline-offset: 1px;
      border-radius: 2px;
    }
  }
}
</style>
