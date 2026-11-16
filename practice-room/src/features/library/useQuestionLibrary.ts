import { computed, ref, shallowRef } from 'vue'
import {
  mergeQuestionBanks,
  parseAnswerFile,
  parseQuestionBank,
  type AnswerItem,
  type QuestionBank
} from '../common/practice-data.ts'
import type { PracticeSessionSnapshot } from '../practice/types.ts'

export type BankEntry = {
  key: string
  bank: QuestionBank
  bankFileName: string
  answerFileName: string
  answers: Map<string, AnswerItem>
  isMerged: boolean
  session: PracticeSessionSnapshot | null
}

type ImportedAnswerFile = {
  fileName: string
  problemSetId: string | null
  answers: Map<string, AnswerItem>
}

type SetNotice = (message: string, isError?: boolean) => void

export function useQuestionLibrary(setNotice: SetNotice) {
  const bankEntries = shallowRef<BankEntry[]>([])
  const activeBankKey = ref<string | null>(null)
  const activeBankEntry = computed(() => bankEntries.value.find((entry) => entry.key === activeBankKey.value) ?? null)
  const bank = computed(() => activeBankEntry.value?.bank ?? null)
  const answerMap = computed(() => activeBankEntry.value?.answers ?? new Map<string, AnswerItem>())
  const mergeSelection = ref<string[]>([])
  const matchedAnswerCount = computed(() => {
    if (!bank.value) return 0
    return bank.value.questions.filter((question) => question.id && answerMap.value.has(question.id)).length
  })
  let nextBankKey = 0

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  async function readJsonFile(file: File): Promise<unknown> {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      return parsed
    } catch {
      throw new Error('文件不是有效的 JSON，请检查文件内容。')
    }
  }

  function getProblemSetId(value: unknown): string | null {
    if (!isRecord(value)) return null
    const problemSetId = value.problemSetId
    return typeof problemSetId === 'string' && problemSetId.trim() ? problemSetId : null
  }

  function normalizedFileStem(value: string): string {
    return value
      .replace(/\.[^.]+$/, '')
      .replace(/(?:[-_\s]?(?:题库|我的答案|答案))$/u, '')
      .normalize('NFKC')
      .trim()
      .toLowerCase()
  }

  function findAnswerBankMatches(answerFile: ImportedAnswerFile): BankEntry[] {
    const entries = bankEntries.value
    if (answerFile.problemSetId) {
      const idMatches = entries.filter((entry) => entry.bank.problemSetId === answerFile.problemSetId)
      if (idMatches.length > 0) {
        if (idMatches.length === 1) return idMatches
        const answerStem = normalizedFileStem(answerFile.fileName)
        const namedMatches = idMatches.filter((entry) => answerStem
          && (answerStem === normalizedFileStem(entry.bankFileName)
            || answerStem === normalizedFileStem(entry.bank.title)))
        return namedMatches.length > 0 ? namedMatches : idMatches
      }
    }

    const answerStem = normalizedFileStem(answerFile.fileName)
    if (!answerStem) return []
    return entries.filter((entry) => {
      if (answerFile.problemSetId && entry.bank.problemSetId) return false
      return answerStem === normalizedFileStem(entry.bankFileName)
        || answerStem === normalizedFileStem(entry.bank.title)
    })
  }

  function selectBank(key: string): void {
    if (bankEntries.value.some((entry) => entry.key === key)) activeBankKey.value = key
  }

  function updateSession(key: string, session: PracticeSessionSnapshot): void {
    bankEntries.value = bankEntries.value.map((entry) => entry.key === key
      ? { ...entry, session }
      : entry)
  }

  async function importFiles(files: readonly File[]): Promise<string | null> {
    if (files.length === 0) return null

    const newEntries: BankEntry[] = []
    const importedAnswers: ImportedAnswerFile[] = []
    const failures: string[] = []
    for (const file of files) {
      try {
        const json = await readJsonFile(file)
        if (!isRecord(json)) {
          throw new Error('JSON 顶层必须是对象。')
        }
        if (Array.isArray(json.questions)) {
          const loadedBank = parseQuestionBank(json)
          const key = `bank-${nextBankKey++}`
          newEntries.push({
            key,
            bank: loadedBank,
            bankFileName: file.name,
            answerFileName: '',
            answers: new Map(),
            isMerged: false,
            session: null
          })
        } else if (Array.isArray(json.answers)) {
          importedAnswers.push({
            fileName: file.name,
            problemSetId: getProblemSetId(json),
            answers: parseAnswerFile(json, null)
          })
        } else {
          throw new Error('无法识别文件类型；需要题库的 questions 或答案的 answers 数组。')
        }
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : '文件导入失败。'}`)
      }
    }

    bankEntries.value = [...bankEntries.value, ...newEntries]

    const pairedBankKeys = new Set<string>()
    const unmatchedFiles: string[] = []
    let pairedAnswerCount = 0
    for (const answerFile of importedAnswers) {
      const matches = findAnswerBankMatches(answerFile)
      if (matches.length !== 1) {
        unmatchedFiles.push(`${answerFile.fileName}${matches.length > 1 ? '（匹配到多个题库）' : ''}`)
        continue
      }

      const [entry] = matches
      if (pairedBankKeys.has(entry.key)) {
        unmatchedFiles.push(`${answerFile.fileName}（同一批次有多个答案文件匹配此题库）`)
        continue
      }

      pairedBankKeys.add(entry.key)
      pairedAnswerCount += 1
      bankEntries.value = bankEntries.value.map((item) => item.key === entry.key
        ? { ...item, answers: answerFile.answers, answerFileName: answerFile.fileName }
        : item)
    }

    const summary = [
      newEntries.length ? `导入题库 ${newEntries.length} 份` : '',
      importedAnswers.length ? `识别答案 ${importedAnswers.length} 份，自动配对 ${pairedAnswerCount} 份` : ''
    ].filter(Boolean).join('；')
    const unmatchedNotice = unmatchedFiles.length
      ? `未能自动配对：${unmatchedFiles.join('、')}。可在对应题库卡片单独导入。`
      : ''
    const failureNotice = failures.length ? `导入失败：${failures.join('；')}` : ''
    setNotice(
      [summary || '没有导入任何题库或答案。', unmatchedNotice, failureNotice].filter(Boolean).join(' '),
      unmatchedFiles.length > 0 || failures.length > 0
    )
    return newEntries[0]?.key ?? null
  }

  async function handleAnswerChange(bankKey: string, event: Event): Promise<void> {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    const entry = bankEntries.value.find((item) => item.key === bankKey)
    if (!file || !entry) return
    input.value = ''

    try {
      const loadedAnswers = parseAnswerFile(await readJsonFile(file), entry.bank.problemSetId)
      bankEntries.value = bankEntries.value.map((item) => item.key === bankKey
        ? { ...item, answers: loadedAnswers, answerFileName: file.name }
        : item)
      if (activeBankKey.value === bankKey) {
        setNotice(`答案已载入并按题目 ID 匹配，共匹配 ${matchedAnswerCount.value} 道。导入答案仅供参考，不代表标准答案。`)
      } else {
        setNotice(`「${entry.bank.title}」的答案已载入。`)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '答案导入失败。', true)
    }
  }

  function mergeSelectedBanks(): void {
    const selectedKeys = new Set(mergeSelection.value)
    const selectedEntries = bankEntries.value.filter((entry) => selectedKeys.has(entry.key))
    if (selectedEntries.length < 2) {
      setNotice('请至少勾选两个题库再合并。', true)
      return
    }

    try {
      const merged = mergeQuestionBanks(selectedEntries.map((entry) => ({
        bank: entry.bank,
        answers: entry.answers
      })))
      const key = `bank-${nextBankKey++}`
      bankEntries.value = [...bankEntries.value, {
        key,
        bank: merged.bank,
        bankFileName: `合并自 ${selectedEntries.length} 个题库`,
        answerFileName: `合并 ${merged.answers.size} 条答案`,
        answers: merged.answers,
        isMerged: true,
        session: null
      }]
      mergeSelection.value = []
      setNotice(
        `已合并 ${selectedEntries.length} 个题库。${merged.duplicateCount ? `按 problemId 去重 ${merged.duplicateCount} 道重复题。` : ''}`
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '题库合并失败。', true)
    }
  }

  function toggleAllBanksSelection(): void {
    mergeSelection.value = mergeSelection.value.length === bankEntries.value.length
      ? []
      : bankEntries.value.map((entry) => entry.key)
  }

  return {
    bankEntries,
    activeBankKey,
    activeBankEntry,
    bank,
    answerMap,
    mergeSelection,
    matchedAnswerCount,
    selectBank,
    updateSession,
    importFiles,
    handleAnswerChange,
    mergeSelectedBanks,
    toggleAllBanksSelection
  }
}
