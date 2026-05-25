<script setup lang="ts">
defineProps<{
  href: string
}>()
</script>

<template>
  <a
    class="md-link"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
  >
    <slot />
  </a>
</template>

<style scoped lang="scss">
.md-link {
  color: #3f7af1;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}
</style>
