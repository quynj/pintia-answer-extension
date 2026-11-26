<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = withDefaults(defineProps<{
  content: string
  interactiveBlanks?: boolean
  blankValues?: string[]
}>(), {
  interactiveBlanks: false,
  blankValues: () => []
})
const emit = defineEmits<{
  'blank-input': [index: number, value: string]
}>()
const contentRoot = ref<HTMLDivElement | null>(null)
const renderedContent = ref('')
let renderRequest = 0

watch(
  () => [props.content, props.interactiveBlanks] as const,
  async ([content, interactiveBlanks]) => {
    const request = ++renderRequest
    const rendered = await renderMarkdown(content, {
      interactiveBlanks,
      blankValues: props.blankValues
    })
    if (request !== renderRequest) return
    renderedContent.value = rendered
    await nextTick()
    if (request === renderRequest) syncBlankValues(props.blankValues)
  },
  { immediate: true }
)

watch(() => props.blankValues, syncBlankValues, { deep: true, flush: 'post' })

function syncBlankValues(values: string[]): void {
  contentRoot.value?.querySelectorAll<HTMLInputElement>('[data-blank-index]').forEach((input) => {
    const index = Number(input.dataset.blankIndex)
    const value = Number.isInteger(index) && index >= 0 ? values[index] ?? '' : ''
    if (input.value !== value) input.value = value
  })
}

function handleInput(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-blank-index')) return
  const index = Number(target.dataset.blankIndex)
  if (Number.isInteger(index) && index >= 0) emit('blank-input', index, target.value)
}
</script>

<template>
  <div ref="contentRoot" class="markdown-content" v-html="renderedContent" @input="handleInput" />
</template>
