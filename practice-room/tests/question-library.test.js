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

test('loads platform banks and paired answers from a JSON catalog', async () => {
  const notices = []
  const library = useQuestionLibrary((message, isError = false) => notices.push({ message, isError }))
  const resources = new Map([
    ['https://example.test/question-banks/catalog.json', {
      banks: [{
        id: 'bank-1',
        questionBankUrl: 'bank-1/questions.json',
        answerUrl: 'bank-1/answers.json'
      }]
    }],
    ['https://example.test/question-banks/bank-1/questions.json', {
      title: '平台题库',
      problemSetId: 'set-1',
      questions: [{ id: 'q-1', type: 'MULTIPLE_CHOICE', content: '第一题', options: ['甲', '乙'] }]
    }],
    ['https://example.test/question-banks/bank-1/answers.json', {
      problemSetId: 'set-1',
      answers: [{ problemId: 'q-1', questionNumber: 1, type: 'MULTIPLE_CHOICE', answer: 'A' }]
    }]
  ])
  const fetcher = async (url) => new Response(JSON.stringify(resources.get(url)), { status: 200 })

  await library.loadPlatformBanks('https://example.test/question-banks/catalog.json', fetcher)

  assert.equal(library.bankEntries.value.length, 1)
  assert.equal(library.bankEntries.value[0].isPlatformBank, true)
  library.selectBank('platform-bank-1')
  assert.equal(library.bank.value?.title, '平台题库')
  assert.equal(library.answerMap.value.get('q-1')?.answer, 'A')
  assert.equal(library.isPlatformBankLoading.value, false)
  assert.equal(notices.at(-1)?.isError, false)
})

test('reports individual platform bank failures without discarding valid banks', async () => {
  const notices = []
  const library = useQuestionLibrary((message, isError = false) => notices.push({ message, isError }))
  const resources = new Map([
    ['https://example.test/catalog.json', {
      banks: [
        { id: 'valid', questionBankUrl: 'valid.json', answerUrl: 'answers.json' },
        { id: 'broken', questionBankUrl: 'missing.json', answerUrl: 'answers.json' }
      ]
    }],
    ['https://example.test/valid.json', {
      title: '可用题库',
      questions: [{ id: 'q-1', type: 'SUBJECTIVE', content: '题目' }]
    }],
    ['https://example.test/answers.json', { problemSetId: null, answers: [] }]
  ])
  const fetcher = async (url) => {
    if (!resources.has(url)) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(resources.get(url)), { status: 200 })
  }

  await library.loadPlatformBanks('https://example.test/catalog.json', fetcher)

  assert.deepEqual(library.bankEntries.value.map((entry) => entry.bank.title), ['可用题库'])
  assert.equal(notices.at(-1)?.isError, true)
  assert.match(notices.at(-1)?.message, /broken.*HTTP 404/)
})

test('rejects insecure cross-origin platform bank URLs', async () => {
  const notices = []
  const library = useQuestionLibrary((message, isError = false) => notices.push({ message, isError }))
  const fetcher = async () => new Response(JSON.stringify({
    banks: [{
      id: 'insecure',
      questionBankUrl: 'http://example.test/questions.json',
      answerUrl: 'answers.json'
    }]
  }), { status: 200 })

  await library.loadPlatformBanks('https://catalog.example.test/catalog.json', fetcher)

  assert.equal(library.bankEntries.value.length, 0)
  assert.equal(notices.at(-1)?.isError, true)
  assert.match(notices.at(-1)?.message, /数据地址无效/)
})
