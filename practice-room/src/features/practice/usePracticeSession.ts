import { computed, ref, shallowRef, type ComputedRef } from 'vue'
import {
  randomQuestionSet,
  shuffleQuestions,
  type AnswerItem,
  type PracticeQuestion,
  type QuestionBank
} from '../common/practice-data.ts'
import type { PracticeResponse, PracticeSessionSnapshot, QuestionProgressStatus } from './types.ts'

type SetNotice = (message: string, isError?: boolean) => void

export function usePracticeSession(
  bank: ComputedRef<QuestionBank | null>,
  answerMap: ComputedRef<Map<string, AnswerItem>>,
  setNotice: SetNotice
) {
  const activeQuestions = ref<PracticeQuestion[]>([])
  const practiceResponses = shallowRef(new Map<string, PracticeResponse>())
  const submittedQuestions = shallowRef(new Set<string>())
  const visibleAnswers = shallowRef(new Set<string>())
  const position = ref(0)
  const restoreOrder = shallowRef<PracticeQuestion[] | null>(null)
  const previewMode = ref<'single' | 'all'>('single')
  const selectedTypes = ref<string[]>([])
  const requestedCount = ref(10)

  const typeNames: Record<string, string> = {
    MULTIPLE_CHOICE: '单选题',
    SINGLE_CHOICE: '单选题',
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: '多选题',
    TRUE_OR_FALSE: '判断题',
    TRUE_FALSE: '判断题',
    FILL_IN_THE_BLANK: '填空题',
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: '程序填空',
    PROGRAMMING: '编程题',
    SQL_PROGRAMMING: 'SQL 编程',
    SUBJECTIVE: '主观题'
  }

  const statusNames: Record<string, string> = {
    PROBLEM_ACCEPTED: '平台标记：通过',
    PROBLEM_WRONG_ANSWER: '平台标记：未通过',
    PROBLEM_PARTIALLY_CORRECT: '平台标记：部分正确',
    PROBLEM_SUBMITTED: '平台标记：已提交',
    PROBLEM_NO_ANSWER: '平台标记：未作答'
  }

  const immediateAnswerTypes = new Set(['MULTIPLE_CHOICE', 'SINGLE_CHOICE', 'TRUE_OR_FALSE', 'TRUE_FALSE'])
  const manualReviewTypes = new Set(['PROGRAMMING', 'SQL_PROGRAMMING', 'SUBJECTIVE', 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'])
  const questionProgressStatuses: QuestionProgressStatus[] = [
    'unanswered',
    'in-progress',
    'correct',
    'wrong',
    'partial',
    'unjudged',
    'manual'
  ]
  const questionProgressStatusNames: Record<QuestionProgressStatus, string> = {
    unanswered: '未作答',
    'in-progress': '作答中',
    correct: '正确',
    wrong: '错误',
    partial: '部分正确',
    unjudged: '待判定',
    manual: '需自行核对'
  }
  const questionProgressStatusSymbols: Record<QuestionProgressStatus, string> = {
    unanswered: '○',
    'in-progress': '◔',
    correct: '✓',
    wrong: '×',
    partial: '◐',
    unjudged: '?',
    manual: '文'
  }

  const questionTypes = computed(() => {
    if (!bank.value) return []
    return [...new Set(bank.value.questions.map((question) => question.type))]
  })
  const questionTypeCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const question of bank.value?.questions ?? []) {
      counts.set(question.type, (counts.get(question.type) ?? 0) + 1)
    }
    return counts
  })
  const currentQuestion = computed(() => activeQuestions.value[position.value] ?? null)
  const currentAnswer = computed(() => {
    const id = currentQuestion.value?.id
    return id ? answerMap.value.get(id) ?? null : null
  })
  const currentQuestionKey = computed(() => currentQuestion.value ? questionKey(currentQuestion.value) : null)
  const currentPracticeResponse = computed(() => responseFor(currentQuestion.value))
  const currentPracticeAnswers = computed(() => responseLines(currentPracticeResponse.value))
  const currentBlankCount = computed(() => blankCountFor(currentQuestion.value))
  const currentAnswerSubmitted = computed(() => {
    const key = currentQuestionKey.value
    return key !== null && submittedQuestions.value.has(key)
  })
  const currentAnswerRequiresSubmit = computed(() => answerRequiresSubmit(currentQuestion.value))
  const canSubmitAnswer = computed(() => canSubmitQuestion(currentQuestion.value))
  const answeredQuestionCount = computed(() => activeQuestions.value.filter(
    hasCompletedQuestion
  ).length)
  const questionProgressStatusCounts = computed(() => {
    const counts = new Map<QuestionProgressStatus, number>(
      questionProgressStatuses.map((status) => [status, 0])
    )
    for (const question of activeQuestions.value) {
      const status = questionProgressStatus(question)
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    return counts
  })
  const activeTotalScore = computed(() => {
    if (activeQuestions.value.length === 0 || activeQuestions.value.some((question) => question.score === null)) {
      return null
    }
    return activeQuestions.value.reduce((sum, question) => sum + (question.score ?? 0), 0)
  })
  const hasQuestions = computed(() => activeQuestions.value.length > 0)
  const isShuffled = computed(() => restoreOrder.value !== null)
  const visiblePosition = computed(() => {
    if (!currentQuestion.value) return '等待导入题库'
    return `${String(position.value + 1).padStart(2, '0')} / ${String(activeQuestions.value.length).padStart(2, '0')}`
  })

  function typeLabel(type: string): string {
    return typeNames[type] ?? type
  }

  function toggleQuestionType(type: string): void {
    const selected = new Set(selectedTypes.value)
    if (selected.has(type)) selected.delete(type)
    else selected.add(type)
    selectedTypes.value = questionTypes.value.filter((questionType) => selected.has(questionType))
    requestedCount.value = selectedTypes.value.reduce(
      (sum, questionType) => sum + (questionTypeCounts.value.get(questionType) ?? 0),
      0
    )
  }

  function responseFor(question: PracticeQuestion | null): PracticeResponse | null {
    if (!question) return null
    return practiceResponses.value.get(questionKey(question)) ?? null
  }

  function responseLines(response: PracticeResponse | null): string[] {
    if (Array.isArray(response)) return response
    return typeof response === 'string' ? [response] : []
  }

  function blankCountFor(question: PracticeQuestion | null): number {
    if (!question) return 1
    const answer = questionAnswer(question)
    return question.blankCount
      || (Array.isArray(answer?.answer) && answer.answer.length > 0 ? answer.answer.length : 1)
  }

  function answerRequiresSubmit(question: PracticeQuestion | null): boolean {
    return question !== null && !immediateAnswerTypes.has(question.type)
  }

  function canSubmitQuestion(question: PracticeQuestion | null): boolean {
    const response = responseFor(question)
    return answerRequiresSubmit(question)
      && hasPracticeResponse(response)
      && (!Array.isArray(response) || response.every((item) => item.trim().length > 0))
  }

  function isCodeQuestion(question: PracticeQuestion | null): boolean {
    return question?.type === 'PROGRAMMING' || question?.type === 'SQL_PROGRAMMING'
  }

  function hasCompletedQuestion(question: PracticeQuestion): boolean {
    const key = questionKey(question)
    return submittedQuestions.value.has(key)
      || (immediateAnswerTypes.has(question.type)
        && hasPracticeResponse(practiceResponses.value.get(key) ?? null))
  }

  function questionProgressStatus(question: PracticeQuestion): QuestionProgressStatus {
    const response = responseFor(question)
    if (response === null || !hasPracticeResponse(response)) return 'unanswered'
    if (!hasCompletedQuestion(question)) return 'in-progress'
    if (manualReviewTypes.has(question.type)) return 'manual'

    const answer = questionAnswer(question)
    const status = answer?.problemStatus
    const matchesImportedAnswer = answer ? responseMatchesAnswer(question, response, answer) : null
    if (status === 'PROBLEM_PARTIALLY_CORRECT') {
      return matchesImportedAnswer === true ? 'partial' : 'unjudged'
    }
    if (status === 'PROBLEM_ACCEPTED') {
      if (matchesImportedAnswer === true) return 'correct'
      if (matchesImportedAnswer === false && canClassifyMismatch(question)) return 'wrong'
    }
    if (status === 'PROBLEM_WRONG_ANSWER' && matchesImportedAnswer === true) return 'wrong'
    return 'unjudged'
  }

  function responseMatchesAnswer(
    question: PracticeQuestion,
    response: PracticeResponse,
    answer: AnswerItem
  ): boolean | null {
    if (immediateAnswerTypes.has(question.type)) {
      if (question.type === 'TRUE_OR_FALSE' || question.type === 'TRUE_FALSE') {
        return typeof response === 'string' && typeof answer.answer === 'boolean'
          ? response === String(answer.answer)
          : null
      }
      return typeof response === 'string' && typeof answer.answer === 'string'
        ? response === answer.answer
        : null
    }
    if (question.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER') {
      const expectedAnswers = answer.answer
      if (!Array.isArray(response) || !Array.isArray(expectedAnswers)) return null
      const expectedValues = expectedAnswers.filter((value): value is string => typeof value === 'string')
      if (expectedValues.length !== expectedAnswers.length) return null
      const expected = new Set(expectedValues)
      return response.length === expected.size && response.every((value) => expected.has(value))
    }
    if (question.type === 'FILL_IN_THE_BLANK') {
      const expectedAnswers = answer.answer
      if (!Array.isArray(response) || !Array.isArray(expectedAnswers)) return null
      const expectedValues = expectedAnswers.filter((value): value is string => typeof value === 'string')
      if (expectedValues.length !== expectedAnswers.length) return null
      return response.length === expectedValues.length
        && response.every((value, index) => value.trim() === expectedValues[index]?.trim())
    }
    return null
  }

  function canClassifyMismatch(question: PracticeQuestion): boolean {
    return immediateAnswerTypes.has(question.type)
      || question.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'
  }

  function questionAnswer(question: PracticeQuestion): AnswerItem | null {
    return question.id ? answerMap.value.get(question.id) ?? null : null
  }

  function questionKey(question: PracticeQuestion): string {
    return question.id ? `id:${question.id}` : `key:${question.key}`
  }

  function hasPracticeResponse(response: PracticeResponse | null): boolean {
    if (typeof response === 'string') return response.trim().length > 0
    return Array.isArray(response) && response.some((item) => item.trim().length > 0)
  }

  function captureSession(): PracticeSessionSnapshot {
    return {
      activeQuestions: activeQuestions.value,
      practiceResponses: practiceResponses.value,
      submittedQuestions: submittedQuestions.value,
      visibleAnswers: visibleAnswers.value,
      position: position.value,
      restoreOrder: restoreOrder.value,
      previewMode: previewMode.value,
      selectedTypes: [...selectedTypes.value],
      requestedCount: requestedCount.value
    }
  }

  function restoreSession(session: PracticeSessionSnapshot | null, selectedBank: QuestionBank | null): void {
    if (!selectedBank) return
    if (session) {
      activeQuestions.value = session.activeQuestions
      practiceResponses.value = session.practiceResponses
      submittedQuestions.value = session.submittedQuestions
      visibleAnswers.value = session.visibleAnswers
      position.value = session.position
      restoreOrder.value = session.restoreOrder
      previewMode.value = session.previewMode
      selectedTypes.value = [...session.selectedTypes]
      requestedCount.value = session.requestedCount
    } else {
      activeQuestions.value = [...selectedBank.questions]
      practiceResponses.value = new Map()
      submittedQuestions.value = new Set()
      visibleAnswers.value = new Set()
      position.value = 0
      restoreOrder.value = null
      selectedTypes.value = [...new Set(selectedBank.questions.map((question) => question.type))]
      requestedCount.value = selectedBank.questions.length
      previewMode.value = 'single'
    }
  }

  function generateSet(wrongOnly = false): void {
    if (!bank.value) return
    const eligible = bank.value.questions.filter(
      (question) => selectedTypes.value.includes(question.type)
        && (!wrongOnly || questionAnswer(question)?.problemStatus === 'PROBLEM_WRONG_ANSWER')
    )
    if (eligible.length === 0) {
      setNotice(
        wrongOnly
          ? '当前题型筛选下没有平台标记为“未通过”的错题。'
          : '当前筛选条件下没有可组卷的题目。',
        true
      )
      return
    }

    const count = Number.isFinite(requestedCount.value)
      ? Math.max(1, Math.min(Math.floor(requestedCount.value), eligible.length))
      : Math.min(10, eligible.length)
    activeQuestions.value = randomQuestionSet(eligible, count)
    position.value = 0
    restoreOrder.value = null
    setNotice(wrongOnly
      ? `已从错题中随机抽取 ${activeQuestions.value.length} 道题。`
      : `已随机抽取 ${activeQuestions.value.length} 道题。`)
  }

  function toggleShuffle(): void {
    if (!hasQuestions.value) return
    if (restoreOrder.value) {
      activeQuestions.value = restoreOrder.value
      restoreOrder.value = null
      setNotice('已恢复当前题组顺序。')
    } else {
      restoreOrder.value = [...activeQuestions.value]
      activeQuestions.value = shuffleQuestions(activeQuestions.value)
      setNotice('当前题目已重新打乱。')
    }
    position.value = 0
  }

  function resetSet(): void {
    if (!bank.value) return
    activeQuestions.value = [...bank.value.questions]
    position.value = 0
    restoreOrder.value = null
    setNotice('已返回完整题库。')
  }

  function moveQuestion(delta: number): void {
    position.value = Math.max(0, Math.min(position.value + delta, activeQuestions.value.length - 1))
  }

  function reviewQuestion(index: number): void {
    position.value = index
    previewMode.value = 'single'
  }

  function showAllQuestions(): void {
    previewMode.value = 'all'
  }

  function setPracticeResponse(question: PracticeQuestion, response: PracticeResponse): void {
    const key = questionKey(question)
    const updated = new Map(practiceResponses.value)
    updated.set(key, response)
    practiceResponses.value = updated
    if (answerRequiresSubmit(question)) {
      const submitted = new Set(submittedQuestions.value)
      submitted.delete(key)
      submittedQuestions.value = submitted
    }
  }

  function isOptionSelected(question: PracticeQuestion, letter: string): boolean {
    const response = responseFor(question)
    return Array.isArray(response) ? response.includes(letter) : response === letter
  }

  function toggleOption(question: PracticeQuestion, letter: string, event: Event): void {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const selected = responseLines(responseFor(question)).filter((answer) => answer !== letter)
    if (input.checked) selected.push(letter)
    setPracticeResponse(question, selected)
  }

  function setBlankResponse(question: PracticeQuestion, index: number, event: Event): void {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    setBlankResponseValue(question, index, input.value)
  }

  function setBlankResponseValue(question: PracticeQuestion, index: number, value: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= blankCountFor(question)) return
    const existingAnswers = responseLines(responseFor(question))
    const responses = Array.from({ length: blankCountFor(question) }, (_, item) => existingAnswers[item] ?? '')
    responses[index] = value
    setPracticeResponse(question, responses)
  }

  function setTextResponse(question: PracticeQuestion, event: Event): void {
    const input = event.target
    if (!(input instanceof HTMLTextAreaElement)) return
    setPracticeResponse(question, input.value)
  }

  function submitPracticeAnswer(question: PracticeQuestion): void {
    const key = questionKey(question)
    if (!canSubmitQuestion(question)) return
    const updated = new Set(submittedQuestions.value)
    updated.add(key)
    submittedQuestions.value = updated
  }

  function isAnswerVisible(question: PracticeQuestion): boolean {
    return visibleAnswers.value.has(questionKey(question))
  }

  function toggleAnswerVisibility(question: PracticeQuestion): void {
    const key = questionKey(question)
    const updated = new Set(visibleAnswers.value)
    if (updated.has(key)) updated.delete(key)
    else updated.add(key)
    visibleAnswers.value = updated
  }

  function redoActiveSet(): void {
    const activeKeys = new Set(activeQuestions.value.map(questionKey))
    practiceResponses.value = new Map(
      [...practiceResponses.value].filter(([key]) => !activeKeys.has(key))
    )
    submittedQuestions.value = new Set(
      [...submittedQuestions.value].filter((key) => !activeKeys.has(key))
    )
    position.value = 0
    setNotice('当前题组的作答记录已清空，可以开始二刷。')
  }

  function answerLines(answer: AnswerItem | null): string[] {
    if (!answer) return []
    if (Array.isArray(answer.answer)) return answer.answer.map((value) => String(value))
    if (typeof answer.answer === 'object' && answer.answer !== null) {
      return [JSON.stringify(answer.answer, null, 2) ?? String(answer.answer)]
    }
    return [String(answer.answer)]
  }

  return {
    bank,
    activeQuestions,
    submittedQuestions,
    visibleAnswers,
    position,
    previewMode,
    selectedTypes,
    requestedCount,
    statusNames,
    questionTypes,
    questionTypeCounts,
    currentQuestion,
    currentAnswer,
    currentPracticeResponse,
    currentPracticeAnswers,
    currentBlankCount,
    currentAnswerSubmitted,
    currentAnswerRequiresSubmit,
    canSubmitAnswer,
    answeredQuestionCount,
    questionProgressStatuses,
    questionProgressStatusNames,
    questionProgressStatusSymbols,
    questionProgressStatusCounts,
    activeTotalScore,
    hasQuestions,
    isShuffled,
    visiblePosition,
    typeLabel,
    toggleQuestionType,
    responseFor,
    responseLines,
    blankCountFor,
    answerRequiresSubmit,
    canSubmitQuestion,
    isCodeQuestion,
    hasCompletedQuestion,
    questionProgressStatus,
    questionAnswer,
    questionKey,
    captureSession,
    restoreSession,
    generateSet,
    toggleShuffle,
    resetSet,
    moveQuestion,
    reviewQuestion,
    showAllQuestions,
    setPracticeResponse,
    isOptionSelected,
    toggleOption,
    setBlankResponse,
    setBlankResponseValue,
    setTextResponse,
    submitPracticeAnswer,
    isAnswerVisible,
    toggleAnswerVisibility,
    redoActiveSet,
    answerLines
  }
}
