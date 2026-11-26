import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { usePracticeSession } from '../src/features/practice/usePracticeSession.ts'

function question(id, text, type = 'SUBJECTIVE') {
  return {
    id,
    key: `question-${id}`,
    number: 1,
    type,
    text,
    options: [],
    blankCount: 0,
    score: null,
    imageUrls: [],
    pintiaUrl: null
  }
}

function bank(title, item) {
  return {
    title,
    problemSetId: null,
    questions: Array.isArray(item) ? item : [item],
    totalScore: null
  }
}

test('restores responses and completion state when switching practice banks', () => {
  const firstQuestion = question('first', '第一题')
  const secondQuestion = question('second', '第二题')
  const activeBank = ref(bank('第一份', firstQuestion))
  const answers = ref(new Map())
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => answers.value),
    () => {}
  )

  session.restoreSession(null, activeBank.value)
  session.setPracticeResponse(firstQuestion, '我的作答')
  session.submitPracticeAnswer(firstQuestion)
  const savedSession = session.captureSession()

  activeBank.value = bank('第二份', secondQuestion)
  session.restoreSession(null, activeBank.value)
  assert.equal(session.responseFor(secondQuestion), null)

  activeBank.value = bank('第一份', firstQuestion)
  session.restoreSession(savedSession, activeBank.value)
  assert.equal(session.responseFor(firstQuestion), '我的作答')
  assert.equal(session.hasCompletedQuestion(firstQuestion), true)
})

test('defaults the requested count to the selected question types', () => {
  const choiceQuestions = [
    question('choice-1', '单选一', 'SINGLE_CHOICE'),
    question('choice-2', '单选二', 'SINGLE_CHOICE')
  ]
  const subjectiveQuestion = question('subjective', '主观题')
  const activeBank = ref(bank('混合题库', [...choiceQuestions, subjectiveQuestion]))
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => new Map()),
    () => {}
  )

  session.restoreSession(null, activeBank.value)
  assert.equal(session.requestedCount.value, 3)

  session.toggleQuestionType('SUBJECTIVE')
  assert.equal(session.requestedCount.value, 2)

  session.toggleQuestionType('SINGLE_CHOICE')
  assert.equal(session.requestedCount.value, 0)
})

test('shows answers independently of completion and restores their visibility', () => {
  const item = question('answer-visibility', '填空题', 'FILL_IN_THE_BLANK')
  const activeBank = ref(bank('答案显隐题库', item))
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => new Map([
      ['answer-visibility', {
        problemId: 'answer-visibility',
        questionNumber: 1,
        type: 'FILL_IN_THE_BLANK',
        answer: ['参考答案']
      }]
    ])),
    () => {}
  )
  session.restoreSession(null, activeBank.value)

  assert.equal(session.hasCompletedQuestion(item), false)
  assert.equal(session.isAnswerVisible(item), false)

  session.toggleAnswerVisibility(item)
  assert.equal(session.isAnswerVisible(item), true)
  const snapshot = session.captureSession()

  session.restoreSession(null, activeBank.value)
  assert.equal(session.isAnswerVisible(item), false)
  session.restoreSession(snapshot, activeBank.value)
  assert.equal(session.isAnswerVisible(item), true)

  session.toggleAnswerVisibility(item)
  assert.equal(session.isAnswerVisible(item), false)
})

test('does not add blank inputs beyond the question blank count', () => {
  const item = { ...question('two-blanks', '填空题', 'FILL_IN_THE_BLANK'), blankCount: 2 }
  const activeBank = ref(bank('填空题库', item))
  const answers = ref(new Map([
    ['two-blanks', {
      problemId: 'two-blanks',
      questionNumber: 1,
      type: 'FILL_IN_THE_BLANK',
      answer: ['答案一', '答案二', '多余答案']
    }]
  ]))
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => answers.value),
    () => {}
  )
  session.restoreSession(null, activeBank.value)

  assert.equal(session.blankCountFor(item), 2)
})

test('redo clears only the current set responses and completion state', () => {
  const writtenQuestion = question('written', '主观题')
  const choiceQuestion = question('choice', '单选题', 'SINGLE_CHOICE')
  const outsideQuestion = question('outside', '题组外主观题')
  const activeBank = ref(bank('练习题库', [writtenQuestion, choiceQuestion, outsideQuestion]))
  const notices = []
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => new Map()),
    (message) => notices.push(message)
  )
  session.restoreSession(null, activeBank.value)

  session.setPracticeResponse(writtenQuestion, '我的文字答案')
  session.submitPracticeAnswer(writtenQuestion)
  session.setPracticeResponse(choiceQuestion, 'A')
  session.setPracticeResponse(outsideQuestion, '题组外答案')
  session.submitPracticeAnswer(outsideQuestion)
  session.activeQuestions.value = [writtenQuestion, choiceQuestion]
  session.position.value = 1
  session.redoActiveSet()

  assert.equal(session.responseFor(writtenQuestion), null)
  assert.equal(session.submittedQuestions.value.has(session.questionKey(writtenQuestion)), false)
  assert.equal(session.hasCompletedQuestion(writtenQuestion), false)
  assert.equal(session.responseFor(choiceQuestion), null)
  assert.equal(session.hasCompletedQuestion(choiceQuestion), false)
  assert.equal(session.responseFor(outsideQuestion), '题组外答案')
  assert.equal(session.hasCompletedQuestion(outsideQuestion), true)
  assert.equal(session.position.value, 0)
  assert.match(notices[0], /二刷/)
})

test('reports progress using imported platform statuses conservatively', () => {
  const acceptedQuestion = question('accepted', '通过题', 'SINGLE_CHOICE')
  const acceptedMismatchQuestion = question('accepted-mismatch', '答案不一致题', 'SINGLE_CHOICE')
  const rejectedQuestion = question('rejected', '未通过题', 'SINGLE_CHOICE')
  const partialQuestion = question('partial', '部分正确题', 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER')
  const blankQuestion = question('blank', '填空题', 'FILL_IN_THE_BLANK')
  const subjectiveQuestion = question('subjective', '主观题')
  const questions = [
    acceptedQuestion,
    acceptedMismatchQuestion,
    rejectedQuestion,
    partialQuestion,
    blankQuestion,
    subjectiveQuestion
  ]
  const records = new Map([
    ['accepted', { problemId: 'accepted', questionNumber: 1, type: 'SINGLE_CHOICE', answer: 'A', problemStatus: 'PROBLEM_ACCEPTED' }],
    ['accepted-mismatch', { problemId: 'accepted-mismatch', questionNumber: 2, type: 'SINGLE_CHOICE', answer: 'A', problemStatus: 'PROBLEM_ACCEPTED' }],
    ['rejected', { problemId: 'rejected', questionNumber: 3, type: 'SINGLE_CHOICE', answer: 'B', problemStatus: 'PROBLEM_WRONG_ANSWER' }],
    ['partial', { problemId: 'partial', questionNumber: 4, type: 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER', answer: ['A', 'B'], problemStatus: 'PROBLEM_PARTIALLY_CORRECT' }],
    ['blank', { problemId: 'blank', questionNumber: 5, type: 'FILL_IN_THE_BLANK', answer: ['标准答案'], problemStatus: 'PROBLEM_ACCEPTED' }],
    ['subjective', { problemId: 'subjective', questionNumber: 6, type: 'SUBJECTIVE', answer: '参考答案', problemStatus: 'PROBLEM_ACCEPTED' }]
  ])
  const activeBank = ref(bank('状态题库', questions))
  const answers = ref(records)
  const session = usePracticeSession(
    computed(() => activeBank.value),
    computed(() => answers.value),
    () => {}
  )
  session.restoreSession(null, activeBank.value)

  assert.equal(session.questionProgressStatus(acceptedQuestion), 'unanswered')

  session.setPracticeResponse(acceptedQuestion, 'A')
  session.setPracticeResponse(acceptedMismatchQuestion, 'B')
  session.setPracticeResponse(rejectedQuestion, 'B')
  session.setPracticeResponse(partialQuestion, ['B', 'A'])
  session.submitPracticeAnswer(partialQuestion)
  session.setPracticeResponse(blankQuestion, ['不同写法'])
  session.submitPracticeAnswer(blankQuestion)
  session.setPracticeResponse(subjectiveQuestion, '我的作答')
  session.submitPracticeAnswer(subjectiveQuestion)

  assert.equal(session.questionProgressStatus(acceptedQuestion), 'correct')
  assert.equal(session.questionProgressStatus(acceptedMismatchQuestion), 'wrong')
  assert.equal(session.questionProgressStatus(rejectedQuestion), 'wrong')
  assert.equal(session.questionProgressStatus(partialQuestion), 'partial')
  assert.equal(session.questionProgressStatus(blankQuestion), 'unjudged')
  assert.equal(session.questionProgressStatus(subjectiveQuestion), 'manual')

  session.setPracticeResponse(rejectedQuestion, 'A')
  assert.equal(session.questionProgressStatus(rejectedQuestion), 'unjudged')
})
