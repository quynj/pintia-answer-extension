export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface PracticeQuestion {
  id: string | null
  key: string
  number: number
  type: string
  text: string
  options: string[]
  blankCount: number
  score: number | null
  imageUrls: string[]
  pintiaUrl: string | null
}

export interface QuestionBank {
  title: string
  problemSetId: string | null
  questions: PracticeQuestion[]
  totalScore: number | null
}

export interface AnswerItem {
  problemId: string
  questionNumber: number | null
  type: string
  answer: JsonValue
  problemStatus?: string
}

export interface MergedQuestionBank {
  bank: QuestionBank
  answers: Map<string, AnswerItem>
  duplicateCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function parseId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isTemplateStem(text: string): boolean {
  return /^(?:这是一个(?:单选题|判断题)的样例|这是一道(?:单选题|判断题)的样例|这是一个SQL编程题模板|这是一道填空题模板|这是一个主观题模板|请在这里(?:写题目描述|写定义表结构的SQL语句|给出输出样例))/u.test(text)
}

function questionStem(value: Record<string, unknown>): { text: string; fromContent: boolean } {
  const content = nonEmptyString(value.content)?.trim() ?? ''
  const apiData = isRecord(value.apiData) ? value.apiData : null
  const description = nonEmptyString(apiData?.description)?.trim() ?? ''
  const prompt = nonEmptyString(value.prompt)?.trim() ?? ''
  const title = nonEmptyString(value.title)?.trim() ?? ''
  const sqlTemplatePrefix = /^这是一个SQL编程题模板[。.]?\s*/u

  if (content && sqlTemplatePrefix.test(content)) {
    const body = content.replace(sqlTemplatePrefix, '').trim()
    if (body.length >= 20) return { text: body, fromContent: true }
  }

  for (const [text, fromContent] of [[content, true], [description, false], [prompt, false]] as const) {
    if (text && !isTemplateStem(text)) return { text, fromContent }
  }
  return { text: title, fromContent: false }
}

function inlineOptionsStart(text: string, options: string[]): number | null {
  if (options.length === 0) return null
  const firstOption = new RegExp(`(?:^|\\s)A[.．、)]\\s*${escapeRegExp(options[0])}`, 'u').exec(text)
  if (!firstOption || firstOption.index === undefined) return null

  let cursor = firstOption.index + firstOption[0].length
  for (let index = 1; index < options.length; index += 1) {
    const label = String.fromCharCode(65 + index)
    const nextOption = new RegExp(
      `\\s+${label}[.．、)]\\s*${escapeRegExp(options[index])}`,
      'u'
    ).exec(text.slice(cursor))
    if (!nextOption || nextOption.index === undefined) return null
    cursor += nextOption.index + nextOption[0].length
  }
  return firstOption.index
}

function safeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((image) => {
    if (!isRecord(image) || typeof image.url !== 'string') return []
    return isHttpsUrl(image.url) ? [image.url] : []
  })
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function hasSafeMarkdownImage(text: string): boolean {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].some((match) => isHttpsUrl(match[1]))
}

function inlineImageSources(text: string, value: unknown): { text: string; hasImages: boolean } {
  if (!Array.isArray(value)) {
    const normalizedText = text.replace(/(!\[[^\]]*\]\()~\/([^)]+)(\))/g, '$1https://images.ptausercontent.com/$2$3')
    return { text: normalizedText, hasImages: hasSafeMarkdownImage(normalizedText) }
  }

  const imageEntries = value.flatMap((image) => {
    if (!isRecord(image) || typeof image.url !== 'string') return []
    if (!isHttpsUrl(image.url)) return []
    return [{
      url: image.url,
      markdownPath: typeof image.markdownPath === 'string' ? image.markdownPath : null
    }]
  })

  const normalizedText = text.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (image, alt, source, suffix) => {
    const resolved = imageEntries.find((entry) => entry.markdownPath === source || entry.url === source)
    const imageUrl = resolved?.url
      ?? (source.startsWith('~/') ? `https://images.ptausercontent.com/${source.slice(2)}` : null)
    return imageUrl ? `![${alt}](${imageUrl}${suffix})` : image
  })
  return {
    text: normalizedText,
    hasImages: hasSafeMarkdownImage(normalizedText)
  }
}

function inlineBlankPositions(value: unknown, textLength: number): number[] {
  if (!isRecord(value)) return []
  const apiData = isRecord(value.apiData) ? value.apiData : null
  const problemConfig = isRecord(apiData?.problemConfig)
    ? apiData.problemConfig
    : isRecord(value.problemConfig)
      ? value.problemConfig
      : null
  const fillInConfig = [
    problemConfig?.fillInTheBlankProblemConfig,
    problemConfig?.fillInTheBlankForProgrammingProblemConfig
  ].find(isRecord)
  if (!Array.isArray(fillInConfig?.blanks)) return []

  return fillInConfig.blanks.flatMap((blank) => {
    if (!isRecord(blank) || typeof blank.index !== 'number'
      || !Number.isInteger(blank.index) || blank.index < 0 || blank.index > textLength) {
      return []
    }
    return [blank.index]
  })
}

function insertInlineBlankMarkers(text: string, positions: number[]): string {
  let result = ''
  let cursor = 0
  for (const [index, position] of [...positions].sort((left, right) => left - right).entries()) {
    result += `${text.slice(cursor, position)}\uE000${index}\uE001`
    cursor = position
  }
  return result + text.slice(cursor)
}

function pintiaProblemSetUrl(source: unknown, problemSetId: string | null): string | null {
  try {
    const url = new URL(typeof source === 'string'
      ? source
      : `https://pintia.cn/problem-sets/${encodeURIComponent(problemSetId ?? '')}`)
    if (url.protocol !== 'https:' || !['pintia.cn', 'www.pintia.cn'].includes(url.hostname)) return null

    const sourceSetId = /^\/problem-sets\/([^/]+)(?:\/problems\/[^/]+)?\/?$/.exec(url.pathname)?.[1]
    const setId = problemSetId?.trim() || sourceSetId || null
    if (!setId || (sourceSetId && sourceSetId !== setId)) return null

    const path = `/problem-sets/${encodeURIComponent(setId)}`
    return `https://${url.hostname}${path}`
  } catch {
    return null
  }
}

export function parseQuestionBank(input: unknown): QuestionBank {
  if (!isRecord(input)) throw new Error('题库必须是 JSON 对象。')
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('题库中没有可练习的 questions 数组。')
  }
  if (input.problemSetId !== undefined && input.problemSetId !== null && typeof input.problemSetId !== 'string') {
    throw new Error('题库 problemSetId 必须是字符串或 null。')
  }

  const questions = input.questions.map((value, index): PracticeQuestion => {
    if (!isRecord(value) || typeof value.type !== 'string' || !value.type.trim()) {
      throw new Error(`第 ${index + 1} 道题缺少有效题型。`)
    }
    const options = Array.isArray(value.options)
      ? value.options.filter((option): option is string => typeof option === 'string')
      : []
    const stem = questionStem(value)
    let text = stem.text
    const rawContent = nonEmptyString(value.content) ?? ''
    const isFillBlank = value.type === 'FILL_IN_THE_BLANK' || value.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
    const isProgrammingFillBlank = value.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
    const blankPositions = isFillBlank
      ? inlineBlankPositions(value, rawContent.length)
      : []
    const visibleBlankCount = [...text.matchAll(/[【[]填空\d+[】\]]/gu)].length
    const explicitBlankCount = [...text.matchAll(/@\[\]\((\d+)\)/g)]
      .reduce((count, match) => count + Number(match[1]), 0)
    const programmingBlankMarkers = isProgrammingFillBlank
      ? [...text.matchAll(/@@\s*\[\s*\]\s*\(\s*\d+\s*\)/g)]
      : []
    let blankCount = programmingBlankMarkers.length
      || visibleBlankCount
      || blankPositions.length
      || explicitBlankCount
      || (text.match(/_{2,}/g) ?? []).length
    if (programmingBlankMarkers.length > 0) {
      let blankIndex = 0
      text = text.replace(/@@\s*\[\s*\]\s*\(\s*\d+\s*\)/g, () => `\uE000${blankIndex++}\uE001`)
      blankCount = programmingBlankMarkers.length
    } else if (visibleBlankCount > 0) {
      let blankIndex = 0
      text = text.replace(/[【[]填空\d+[】\]]/gu, () => `\uE000${blankIndex++}\uE001`)
    } else if (blankPositions.length > 0 && stem.fromContent) {
      text = insertInlineBlankMarkers(rawContent, blankPositions)
      blankCount = blankPositions.length
      if (text !== rawContent && /^这是一个SQL编程题模板/u.test(text)) {
        text = text.replace(/^这是一个SQL编程题模板[。.]?\s*/u, '')
      }
    }
    text = text.replace(/@@?\s*\[\s*\]\s*\(\s*\d+\s*\)/g, '')
    if (value.type === 'FILL_IN_THE_BLANK' || value.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
      const withoutBlankHint = text.replace(
        /(?:\r?\n\s*)*填空位置[：:]\s*(?:_{2,}(?:\s*[、,，/]\s*_{2,})*)\s*$/u,
        ''
      )
      if (withoutBlankHint.trim()) text = withoutBlankHint
    }
    text = text
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/&nbsp;/giu, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\\(_{2,})\\_/g, '$1')
    text = text.replace(/(?:请在这里写定义表结构的SQL语句|请在这里给出输出样例)[。.]?/gu, '')
    const choicesStart = inlineOptionsStart(text, options)
    if (choicesStart !== null) text = text.slice(0, choicesStart).trimEnd()
    const inlineImages = inlineImageSources(text, value.images)
    text = inlineImages.text
    const imageUrls = inlineImages.hasImages ? [] : safeImageUrls(value.images)
    if (!text && imageUrls.length === 0) throw new Error(`第 ${index + 1} 道题缺少题干或图片。`)

    const number = typeof value.number === 'number' && Number.isFinite(value.number)
      ? value.number
      : typeof value.questionNumber === 'number' && Number.isFinite(value.questionNumber)
        ? value.questionNumber
        : index + 1
    const score = typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0
      ? value.score
      : null
    const apiData = isRecord(value.apiData) ? value.apiData : null
    const questionProblemSetId = parseId(apiData?.problemSetId) ?? parseId(input.problemSetId)

    return {
      id: parseId(value.id) ?? parseId(value.problemId),
      key: `question-${index + 1}`,
      number,
      type: value.type,
      text,
      options,
      blankCount,
      score,
      imageUrls,
      pintiaUrl: pintiaProblemSetUrl(input.source, questionProblemSetId)
    }
  })

  let summaryScore: number | null = null
  if (isRecord(input.summaries)) {
    const scores = Object.values(input.summaries)
      .filter(isRecord)
      .map((summary) => summary.totalScore)
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0)
    if (scores.length > 0) summaryScore = scores.reduce((sum, score) => sum + score, 0)
  }

  const questionScores = questions.map((question) => question.score)
  const totalScore = summaryScore
    ?? (questionScores.every((score): score is number => score !== null)
      ? questionScores.reduce((sum, score) => sum + score, 0)
      : null)

  return {
    title: nonEmptyString(input.title) ?? nonEmptyString(input.problemSetName) ?? '未命名题库',
    problemSetId: typeof input.problemSetId === 'string' ? input.problemSetId : null,
    questions,
    totalScore
  }
}

export function parseAnswerFile(input: unknown, expectedProblemSetId: string | null): Map<string, AnswerItem> {
  if (!isRecord(input)) throw new Error('答案必须是 JSON 对象。')
  const problemSetId = input.problemSetId
  if (problemSetId !== null && typeof problemSetId !== 'string') {
    throw new Error('答案 problemSetId 必须是字符串或 null。')
  }
  if (expectedProblemSetId && problemSetId && expectedProblemSetId !== problemSetId) {
    throw new Error('答案中的 problemSetId 与当前题集不匹配。')
  }
  if (!Array.isArray(input.answers)) throw new Error('answers 必须是数组。')

  const seenIds = new Set<string>()
  const answers = input.answers.map((value, index): AnswerItem => {
    if (!isRecord(value)) throw new Error(`answers[${index}] 必须是对象。`)
    const problemId = value.problemId
    const questionNumber = value.questionNumber
    const type = value.type
    const answer = value.answer
    if (typeof problemId !== 'string' || !problemId.trim()) {
      throw new Error(`answers[${index}].problemId 必须是非空字符串。`)
    }
    if (seenIds.has(problemId)) throw new Error(`problemId 重复：${problemId}`)
    seenIds.add(problemId)
    if (questionNumber !== null && typeof questionNumber !== 'number') {
      throw new Error(`answers[${index}].questionNumber 必须是数字或 null。`)
    }
    if (typeof type !== 'string' || !type) throw new Error(`answers[${index}].type 必须是非空字符串。`)
    if (!Object.prototype.hasOwnProperty.call(value, 'answer') || !isJsonValue(answer)) {
      throw new Error(`answers[${index}].answer 必须是合法 JSON 值。`)
    }
    if (value.problemStatus !== undefined && typeof value.problemStatus !== 'string') {
      throw new Error(`answers[${index}].problemStatus 必须是字符串。`)
    }

    const label = questionNumber ?? index + 1
    if ((type === 'MULTIPLE_CHOICE' || type === 'SINGLE_CHOICE') && (typeof answer !== 'string' || !answer)) {
      throw new Error(`题目 ${label} 的单选答案必须是非空字符串。`)
    }
    if (type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'
      && (!stringArray(answer) || new Set(answer).size !== answer.length)) {
      throw new Error(`题目 ${label} 的多选答案必须是无重复字符串数组。`)
    }
    if ((type === 'TRUE_OR_FALSE' || type === 'TRUE_FALSE') && typeof answer !== 'boolean') {
      throw new Error(`题目 ${label} 的判断答案必须是布尔值。`)
    }
    if ((type === 'FILL_IN_THE_BLANK' || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') && !stringArray(answer)) {
      throw new Error(`题目 ${label} 的填空答案必须是字符串数组。`)
    }
    if ((type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING')
      && (typeof answer !== 'string' || !answer.trim())) {
      throw new Error(`题目 ${label} 的编程答案必须是非空字符串。`)
    }
    if (type === 'SUBJECTIVE' && typeof answer !== 'string') {
      throw new Error(`题目 ${label} 的主观题答案必须是字符串。`)
    }

    return {
      problemId,
      questionNumber,
      type,
      answer,
      ...(value.problemStatus !== undefined ? { problemStatus: value.problemStatus } : {})
    }
  })

  return new Map(answers.map((answer) => [answer.problemId, answer]))
}

export function mergeQuestionBanks(
  sources: readonly { bank: QuestionBank; answers: ReadonlyMap<string, AnswerItem> }[]
): MergedQuestionBank {
  if (sources.length < 2) throw new Error('至少选择两个题库才能合并。')

  const questions: PracticeQuestion[] = []
  const seenIds = new Set<string>()
  const answers = new Map<string, AnswerItem>()
  let duplicateCount = 0

  for (const [sourceIndex, source] of sources.entries()) {
    for (const [questionIndex, question] of source.bank.questions.entries()) {
      if (question.id && seenIds.has(question.id)) {
        duplicateCount += 1
      } else {
        questions.push({
          ...question,
          number: questions.length + 1,
          key: `merged-${sourceIndex}-${questionIndex}`
        })
        if (question.id) seenIds.add(question.id)
      }

      if (question.id && !answers.has(question.id)) {
        const answer = source.answers.get(question.id)
        if (answer) answers.set(question.id, answer)
      }
    }
  }

  const totalScore = questions.every((question) => question.score !== null)
    ? questions.reduce((sum, question) => sum + (question.score ?? 0), 0)
    : null

  return {
    bank: {
      title: `合并题库（${sources.length} 份）`,
      problemSetId: null,
      questions,
      totalScore
    },
    answers,
    duplicateCount
  }
}

export function shuffleQuestions<T>(questions: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...questions]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

export function randomQuestionSet<T>(
  questions: readonly T[],
  count: number,
  random: () => number = Math.random
): T[] {
  const limit = Number.isFinite(count) ? Math.max(0, Math.min(Math.floor(count), questions.length)) : 0
  return shuffleQuestions(questions, random).slice(0, limit)
}
