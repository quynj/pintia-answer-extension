import {
  parseAnswerFile,
  parseQuestionBank,
  type AnswerItem,
  type QuestionBank
} from '../common/practice-data.ts'

export type PlatformQuestionBank = {
  id: string
  bank: QuestionBank
  answers: Map<string, AnswerItem>
  categories: BankCategory[]
}

export type BankCategory = {
  id: string
  name: string
}

export const LOCAL_IMPORT_CATEGORY: BankCategory = { id: 'source.local-import', name: '本地导入' }
export const MERGED_BANK_CATEGORY: BankCategory = { id: 'source.merged', name: '合并' }
export const UNCATEGORIZED_BANK_CATEGORY: BankCategory = { id: 'source.uncategorized', name: '未分类' }

type CatalogRecord = {
  id: string
  questionBankUrl: string
  answerUrl: string
  categories: BankCategory[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCatalogCategories(value: unknown): BankCategory[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('目录 categories 必须是数组。')

  const categories: BankCategory[] = []
  const seenIds = new Set<string>()
  for (const [index, category] of value.entries()) {
    if (!isRecord(category)) throw new Error(`分类第 ${index + 1} 项必须是对象。`)
    if (typeof category.id !== 'string' || !category.id.trim()) {
      throw new Error(`分类第 ${index + 1} 项缺少有效 id。`)
    }
    if (typeof category.name !== 'string' || !category.name.trim()) {
      throw new Error(`分类 ${category.id} 缺少有效 name。`)
    }
    const id = category.id.trim()
    if (seenIds.has(id)) throw new Error(`目录分类 id 重复：${id}。`)
    if ([
      LOCAL_IMPORT_CATEGORY.id,
      MERGED_BANK_CATEGORY.id,
      UNCATEGORIZED_BANK_CATEGORY.id
    ].includes(id)) {
      throw new Error(`目录分类 id 使用了保留值：${id}。`)
    }
    seenIds.add(id)
    categories.push({ id, name: category.name.trim() })
  }
  return categories
}

function parseCatalogRecord(
  value: unknown,
  index: number,
  catalogUrl: string,
  categoriesById: ReadonlyMap<string, BankCategory>
): CatalogRecord {
  if (!isRecord(value)) throw new Error(`第 ${index + 1} 项必须是对象。`)
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error(`第 ${index + 1} 项缺少有效 id。`)
  }
  if (typeof value.questionBankUrl !== 'string' || !value.questionBankUrl.trim()) {
    throw new Error(`题库 ${value.id} 缺少 questionBankUrl。`)
  }
  if (typeof value.answerUrl !== 'string' || !value.answerUrl.trim()) {
    throw new Error(`题库 ${value.id} 缺少 answerUrl。`)
  }
  if (value.categoryIds !== undefined && !Array.isArray(value.categoryIds)) {
    throw new Error(`题库 ${value.id} 的 categoryIds 必须是数组。`)
  }

  const categoryIds = Array.isArray(value.categoryIds) ? value.categoryIds : []
  const categories: BankCategory[] = []
  const seenCategoryIds = new Set<string>()
  for (const categoryId of categoryIds) {
    if (typeof categoryId !== 'string' || !categoryId.trim()) {
      throw new Error(`题库 ${value.id} 的 categoryIds 含有无效分类 id。`)
    }
    const normalizedCategoryId = categoryId.trim()
    if (seenCategoryIds.has(normalizedCategoryId)) {
      throw new Error(`题库 ${value.id} 的 categoryIds 含有重复分类：${normalizedCategoryId}。`)
    }
    const category = categoriesById.get(normalizedCategoryId)
    if (!category) throw new Error(`题库 ${value.id} 引用了未定义的分类：${normalizedCategoryId}。`)
    seenCategoryIds.add(normalizedCategoryId)
    categories.push(category)
  }

  const catalogBase = new URL(catalogUrl)
  const questionBankUrl = new URL(value.questionBankUrl, catalogBase)
  const answerUrl = new URL(value.answerUrl, catalogBase)
  for (const url of [questionBankUrl, answerUrl]) {
    const isLocalHttp = url.protocol === 'http:'
      && catalogBase.protocol === 'http:'
      && url.origin === catalogBase.origin
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password) {
      throw new Error(`题库 ${value.id} 的数据地址无效。`)
    }
  }

  return {
    id: value.id.trim(),
    questionBankUrl: questionBankUrl.href,
    answerUrl: answerUrl.href,
    categories: categories.length > 0 ? categories : [UNCATEGORIZED_BANK_CATEGORY]
  }
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）：${url}`)
  return await response.json()
}

export async function loadQuestionBankCatalog(
  catalogUrl: string,
  fetcher: typeof fetch = fetch
): Promise<{ banks: PlatformQuestionBank[]; failures: string[] }> {
  const catalog = await fetchJson(catalogUrl, fetcher)
  if (!isRecord(catalog) || !Array.isArray(catalog.banks)) {
    throw new Error('目录 JSON 必须包含 banks 数组。')
  }

  const categories = parseCatalogCategories(catalog.categories)
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const banks: PlatformQuestionBank[] = []
  const failures: string[] = []
  const seenIds = new Set<string>()
  for (const [index, value] of catalog.banks.entries()) {
    let id = `第 ${index + 1} 项`
    try {
      const record = parseCatalogRecord(value, index, catalogUrl, categoriesById)
      id = record.id
      if (seenIds.has(record.id)) throw new Error(`目录中题库 id 重复：${record.id}。`)
      seenIds.add(record.id)

      const [questionBankJson, answerJson] = await Promise.all([
        fetchJson(record.questionBankUrl, fetcher),
        fetchJson(record.answerUrl, fetcher)
      ])
      const bank = parseQuestionBank(questionBankJson)
      const answers = parseAnswerFile(answerJson, bank.problemSetId)
      banks.push({ id: record.id, bank, answers, categories: record.categories })
    } catch (error) {
      failures.push(`${id}：${error instanceof Error ? error.message : '载入失败。'}`)
    }
  }

  return { banks, failures }
}
