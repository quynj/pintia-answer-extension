import type { PracticeQuestion } from '../common/practice-data.ts'

export type PracticeResponse = string | string[]

export type QuestionProgressStatus =
  | 'unanswered'
  | 'in-progress'
  | 'correct'
  | 'wrong'
  | 'partial'
  | 'unjudged'
  | 'manual'

export type PracticeSessionSnapshot = {
  activeQuestions: PracticeQuestion[]
  practiceResponses: Map<string, PracticeResponse>
  submittedQuestions: Set<string>
  position: number
  restoreOrder: PracticeQuestion[] | null
  previewMode: 'single' | 'all'
  selectedTypes: string[]
  requestedCount: number
}
