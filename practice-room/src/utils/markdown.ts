import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
})

const imageRenderer = markdown.renderer.rules.image

markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const source = token.attrGet('src')
  if (typeof source !== 'string' || !isHttpsUrl(source) || !imageRenderer) return ''

  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  token.attrSet('referrerpolicy', 'no-referrer')
  return imageRenderer(tokens, index, options, env, renderer)
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function renderMarkdown(source: string): string {
  const rendered = markdown.render(source).replace(/\uE000(\d+)\uE001/g, (_, index: string) => (
    `<span class="inline-blank" aria-label="填空 ${Number(index) + 1}"></span>`
  ))
  return String(DOMPurify.sanitize(rendered, {
    ADD_ATTR: ['loading', 'decoding', 'referrerpolicy']
  }))
}
