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
}

type CatalogRecord = {
  id: string
  questionBankUrl: string
  answerUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCatalogRecord(value: unknown, index: number, catalogUrl: string): CatalogRecord {
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
    answerUrl: answerUrl.href
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

  const banks: PlatformQuestionBank[] = []
  const failures: string[] = []
  const seenIds = new Set<string>()
  for (const [index, value] of catalog.banks.entries()) {
    let id = `第 ${index + 1} 项`
    try {
      const record = parseCatalogRecord(value, index, catalogUrl)
      id = record.id
      if (seenIds.has(record.id)) throw new Error(`目录中题库 id 重复：${record.id}。`)
      seenIds.add(record.id)

      const [questionBankJson, answerJson] = await Promise.all([
        fetchJson(record.questionBankUrl, fetcher),
        fetchJson(record.answerUrl, fetcher)
      ])
      const bank = parseQuestionBank(questionBankJson)
      const answers = parseAnswerFile(answerJson, bank.problemSetId)
      banks.push({ id: record.id, bank, answers })
    } catch (error) {
      failures.push(`${id}：${error instanceof Error ? error.message : '载入失败。'}`)
    }
  }

  return { banks, failures }
}
