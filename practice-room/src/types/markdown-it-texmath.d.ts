declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it'
  import type { KatexOptions, renderToString } from 'katex'

  interface TexmathOptions {
    engine?: { renderToString: typeof renderToString }
    delimiters?: string | string[]
    katexOptions?: KatexOptions
  }

  function texmath(markdown: MarkdownIt, options?: TexmathOptions): void

  export default texmath
}
