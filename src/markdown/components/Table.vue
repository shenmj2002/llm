<script setup lang="ts">
defineProps<{
  html: string
}>()
</script>

<template>
  <div class="md-table-wrapper" v-html="html" />
</template>

<style scoped lang="scss">
.md-table-wrapper {
  margin: 0.5rem 0;
  overflow-x: auto;
  width: 100%;

  :deep(table),
  :deep(.md-table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0;
  }

  :deep(th),
  :deep(td) {
    border: 1px solid var(--border-color, #e2e8f0);
    padding: 0.5rem;
  }

  :deep(th) {
    background-color: var(--code-header-bg, #f8fafc);
  }
}
</style>
