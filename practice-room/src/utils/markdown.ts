import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

type MarkdownRenderOptions = { interactiveBlanks?: boolean; blankValues?: string[] }
type MarkdownRenderer = InstanceType<typeof MarkdownIt>

const markdown = createMarkdown()
let mathMarkdown: Promise<MarkdownRenderer> | null = null

function createMarkdown(): MarkdownRenderer {
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true
  })
  const imageRenderer = instance.renderer.rules.image

  instance.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index]
    const source = token.attrGet('src')
    if (typeof source !== 'string' || !isHttpsUrl(source) || !imageRenderer) return ''

    token.attrSet('loading', 'lazy')
    token.attrSet('decoding', 'async')
    token.attrSet('referrerpolicy', 'no-referrer')
    return imageRenderer(tokens, index, options, env, renderer)
  }

  return instance
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export async function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): Promise<string> {
  const renderer = hasMath(source) ? await getMathMarkdown() : markdown
  const rendered = renderer.render(source).replace(/\uE000(\d+)\uE001/g, (_match: string, rawIndex: string) => {
    const index = Number(rawIndex)
    if (options.interactiveBlanks) {
      const value = escapeAttributeValue(options.blankValues?.[index] ?? '')
      return `<input class="inline-blank-input" data-blank-index="${index}" aria-label="填空 ${index + 1}" autocomplete="off" value="${value}">`
    }
    return `<span class="inline-blank" aria-label="填空 ${index + 1}"></span>`
  })
  return String(DOMPurify.sanitize(rendered, {
    ADD_ATTR: ['loading', 'decoding', 'referrerpolicy', 'data-blank-index']
  }))
}

function hasMath(source: string): boolean {
  return source.includes('$$') || /(^|[^\\])\$[^$\n]+\$/.test(source)
}

async function getMathMarkdown(): Promise<MarkdownRenderer> {
  if (!mathMarkdown) {
    mathMarkdown = Promise.all([
      import('markdown-it-texmath'),
      import('katex/dist/katex.min.css')
    ]).then(([{ default: texmath }]) => {
      const instance = createMarkdown()
      instance.use(texmath, {
        delimiters: 'dollars',
        katexOptions: { throwOnError: false }
      })
      return instance
    })
  }
  return mathMarkdown
}

function escapeAttributeValue(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character)
}
