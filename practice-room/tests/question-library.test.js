import assert from 'node:assert/strict'
import test from 'node:test'
import { useQuestionLibrary } from '../src/features/library/useQuestionLibrary.ts'

test('imports and pairs bank and answer files before returning the new bank key', async () => {
  const notices = []
  const library = useQuestionLibrary((message, isError = false) => notices.push({ message, isError }))
  const bank = {
    title: '示例题集',
    problemSetId: 'set-1',
    questions: [{ id: 'q-1', type: 'MULTIPLE_CHOICE', content: '第一题', options: ['甲', '乙'] }]
  }
  const answers = {
    problemSetId: 'set-1',
    answers: [{ problemId: 'q-1', questionNumber: 1, type: 'MULTIPLE_CHOICE', answer: 'A' }]
  }

  const selectedKey = await library.importFiles([
    new File([JSON.stringify(bank)], 'set-1-题库.json', { type: 'application/json' }),
    new File([JSON.stringify(answers)], 'set-1-我的答案.json', { type: 'application/json' })
  ])

  assert.equal(selectedKey, 'bank-0')
  assert.equal(library.activeBankKey.value, null)
  library.selectBank(selectedKey)
  assert.equal(library.bank.value?.title, '示例题集')
  assert.equal(library.answerMap.value.get('q-1')?.answer, 'A')
  assert.equal(library.matchedAnswerCount.value, 1)
  assert.equal(notices.at(-1)?.isError, false)
})
