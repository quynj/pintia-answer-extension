import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAnswerFile,
  mergeQuestionBanks,
  parseQuestionBank,
  randomQuestionSet,
  shuffleQuestions
} from '../src/features/common/practice-data.ts'

const bankFixture = {
  title: '示例题集',
  problemSetId: 'set-1',
  summaries: { MULTIPLE_CHOICE: { total: 2, totalScore: 4 } },
  questions: [
    { id: 'q-1', number: 1, type: 'MULTIPLE_CHOICE', prompt: '第一题', score: 2, options: ['甲', '乙'] },
    { id: 'q-2', number: 2, type: 'MULTIPLE_CHOICE', content: '第二题' }
  ]
}

test('parses the exported bank shape and reads summary score', () => {
  const bank = parseQuestionBank(bankFixture)
  assert.equal(bank.title, '示例题集')
  assert.equal(bank.problemSetId, 'set-1')
  assert.equal(bank.questions[1].text, '第二题')
  assert.equal(bank.totalScore, 4)
})

test('builds a Pintia problem-set link from the exported ID', () => {
  const bank = parseQuestionBank({
    problemSetId: 'set-1',
    source: 'https://pintia.cn/problem-sets/set-1',
    questions: [{
      type: 'SUBJECTIVE',
      content: '题目',
      apiData: { problemSetId: 'set-1', problemId: 'problem-1' }
    }]
  })
  assert.equal(bank.questions[0].pintiaUrl, 'https://pintia.cn/problem-sets/set-1')
})

test('preserves Markdown image syntax and only accepts HTTPS image fields', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'SUBJECTIVE',
      content: '查看图片 ![结构图](~/image.png)',
      images: [{ url: 'https://images.ptausercontent.com/image.png' }, { url: 'javascript:alert(1)' }]
    }]
  })
  assert.equal(bank.questions[0].text, '查看图片 ![结构图](https://images.ptausercontent.com/image.png)')
  assert.deepEqual(bank.questions[0].imageUrls, [])
})

test('keeps Markdown and derives the number of fill-in blanks', () => {
  const bank = parseQuestionBank({
    questions: [
      {
        type: 'FILL_IN_THE_BLANK',
        prompt: '使用 `COUNT(*)` 统计记录数：@[](2)',
        options: []
      },
      {
        type: 'FILL_IN_THE_BLANK',
        prompt: '填空位置：________、________'
      }
    ]
  })
  assert.equal(bank.questions[0].text, '使用 `COUNT(*)` 统计记录数：')
  assert.equal(bank.questions[0].blankCount, 2)
  assert.equal(bank.questions[1].blankCount, 2)
})

test('places configured fill-in blanks at their stem offsets and removes the trailing blank hint', () => {
  const text = '请填写：\nALTER TABLE course ADD ;\n\n填空位置：________、________'
  const bank = parseQuestionBank({
    questions: [{
      type: 'FILL_IN_THE_BLANK',
      content: text,
      apiData: {
        problemConfig: {
          fillInTheBlankProblemConfig: {
            blanks: [{ index: 23 }, { index: 28 }]
          }
        }
      }
    }]
  })

  assert.equal(bank.questions[0].blankCount, 2)
  assert.equal(bank.questions[0].text, '请填写：\nALTER TABLE course\uE0000\uE001 ADD \uE0001\uE001;')
})

test('prefers formatted question content when prompt is flattened', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'MULTIPLE_CHOICE',
      prompt: '创建表： ``` CREATE TABLE sample(id INT) ```',
      content: '创建表：\n\n```sql\nCREATE TABLE sample(id INT);\n```',
      options: ['A', 'B']
    }]
  })
  assert.equal(bank.questions[0].text, '创建表：\n\n```sql\nCREATE TABLE sample(id INT);\n```')
})

test('skips sample stems and uses a real API description or title', () => {
  const bank = parseQuestionBank({
    questions: [
      {
        type: 'TRUE_OR_FALSE',
        content: '这是一个判断题的样例。答案为T，分值为5分。',
        prompt: '这是一个判断题的样例。答案为T，分值为5分。',
        title: '真实题干',
        apiData: { description: ' 真实题干 ' }
      },
      {
        type: 'MULTIPLE_CHOICE',
        content: '这是一个单选题的样例。答案为C，分值为2分。',
        prompt: '这是一个单选题的样例。答案为C，分值为2分。',
        title: '标题题干'
      }
    ]
  })

  assert.deepEqual(bank.questions.map((question) => question.text), ['真实题干', '标题题干'])
})

test('removes only the SQL template prefix when it precedes a real question', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'SQL_PROGRAMMING',
      content: '这是一个SQL编程题模板。\n查询 Grade 表中的记录，并按成绩排序。\n\n### 表结构',
      title: '短标题'
    }]
  })

  assert.equal(bank.questions[0].text, '查询 Grade 表中的记录，并按成绩排序。\n\n### 表结构')
})

test('converts existing fill-in labels without duplicating configured blank positions', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'FILL_IN_THE_BLANK',
      content: '填写：<br>【填空1】&nbsp;[填空2]\\____\\_',
      apiData: {
        problemConfig: {
          fillInTheBlankProblemConfig: {
            blanks: [{ index: 8 }, { index: 16 }]
          }
        }
      }
    }]
  })

  assert.equal(bank.questions[0].blankCount, 2)
  assert.equal(bank.questions[0].text, '填写：\n\uE0000\uE001 \uE0001\uE001____')
})

test('resolves Pintia image placeholders to their HTTPS sources', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'SUBJECTIVE',
      prompt: '查看图片：![表结构](~/diagram.png)',
      images: [{
        url: 'https://images.ptausercontent.com/diagram.png',
        markdownPath: '~/diagram.png'
      }]
    }]
  })
  assert.equal(bank.questions[0].text, '查看图片：![表结构](https://images.ptausercontent.com/diagram.png)')
  assert.deepEqual(bank.questions[0].imageUrls, [])
})

test('resolves Pintia image placeholders without image metadata', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'SUBJECTIVE',
      content: '查看图片：![结构图](~/diagram.png)'
    }]
  })

  assert.equal(bank.questions[0].text, '查看图片：![结构图](https://images.ptausercontent.com/diagram.png)')
})

test('removes inline choices when the export also provides a separate options list', () => {
  const bank = parseQuestionBank({
    questions: [{
      type: 'MULTIPLE_CHOICE',
      prompt: '每一行叫做记录或（）。 @[](2) A. 元组 B. 域',
      options: ['元组', '域']
    }]
  })
  assert.equal(bank.questions[0].text, '每一行叫做记录或（）。')
  assert.deepEqual(bank.questions[0].options, ['元组', '域'])
})

test('rejects empty or malformed question banks', () => {
  assert.throws(() => parseQuestionBank({ questions: [] }), /没有可练习/)
  assert.throws(() => parseQuestionBank({
    questions: [{ type: 'MULTIPLE_CHOICE', prompt: '题目' }, null]
  }), /第 2 道题缺少有效题型/)
})

test('matches answers by exact ID and rejects a different problem set', () => {
  const answers = parseAnswerFile({
    problemSetId: 'set-1',
    answers: [{
      questionNumber: 1,
      problemId: 'q-1',
      type: 'MULTIPLE_CHOICE',
      answer: 'A'
    }]
  }, 'set-1')
  assert.equal(answers.get('q-1')?.answer, 'A')
  const aliases = parseAnswerFile({
    problemSetId: null,
    answers: [
      { questionNumber: 1, problemId: 'q-2', type: 'SINGLE_CHOICE', answer: 'B' },
      { questionNumber: 2, problemId: 'q-3', type: 'TRUE_FALSE', answer: false }
    ]
  }, null)
  assert.equal(aliases.get('q-2')?.answer, 'B')
  assert.equal(aliases.get('q-3')?.answer, false)
  assert.throws(() => parseAnswerFile({
    problemSetId: 'other-set',
    answers: []
  }, 'set-1'), /不匹配/)
})

test('uses the question ID rather than an alternate problem ID for answer matching', () => {
  const bank = parseQuestionBank({
    questions: [{
      id: 'question-id',
      problemId: 'alternate-problem-id',
      type: 'MULTIPLE_CHOICE',
      content: '题目'
    }]
  })
  const answers = parseAnswerFile({
    problemSetId: null,
    answers: [{
      questionNumber: 1,
      problemId: 'question-id',
      type: 'MULTIPLE_CHOICE',
      answer: 'A'
    }]
  }, null)

  assert.equal(bank.questions[0].id, 'question-id')
  assert.equal(answers.has(bank.questions[0].id), true)
})

test('rejects duplicate answer IDs and unsupported answer shapes', () => {
  const item = { questionNumber: 1, problemId: 'q-1', type: 'MULTIPLE_CHOICE', answer: 'A' }
  assert.throws(() => parseAnswerFile({ problemSetId: null, answers: [item, item] }, null), /problemId 重复/)
  assert.throws(() => parseAnswerFile({
    problemSetId: null,
    answers: [{ ...item, answer: ['A'] }]
  }, null), /单选答案必须是非空字符串/)
})

test('merges question banks in order, deduplicates IDs, and keeps first matching answers', () => {
  const firstBank = parseQuestionBank({
    title: '第一份',
    questions: [
      { id: 'q-1', number: 1, type: 'MULTIPLE_CHOICE', content: '原题', options: ['甲'], score: 2 },
      { number: 2, type: 'SUBJECTIVE', content: '无 ID 的题目', score: 3 }
    ]
  })
  const secondBank = parseQuestionBank({
    title: '第二份',
    questions: [
      { id: 'q-1', number: 8, type: 'MULTIPLE_CHOICE', content: '重复题', options: ['乙'], score: 8 },
      { id: 'q-3', number: 3, type: 'MULTIPLE_CHOICE', content: '新增题', options: ['丙'], score: 4 },
      { number: 2, type: 'SUBJECTIVE', content: '另一道无 ID 的题目', score: 5 }
    ]
  })
  const firstAnswers = parseAnswerFile({
    problemSetId: null,
    answers: [{ questionNumber: 1, problemId: 'q-1', type: 'MULTIPLE_CHOICE', answer: 'A' }]
  }, null)
  const secondAnswers = parseAnswerFile({
    problemSetId: null,
    answers: [
      { questionNumber: 8, problemId: 'q-1', type: 'MULTIPLE_CHOICE', answer: 'B' },
      { questionNumber: 3, problemId: 'q-3', type: 'MULTIPLE_CHOICE', answer: 'A' }
    ]
  }, null)

  const merged = mergeQuestionBanks([
    { bank: firstBank, answers: firstAnswers },
    { bank: secondBank, answers: secondAnswers }
  ])
  assert.equal(merged.bank.title, '合并题库（2 份）')
  assert.equal(merged.bank.problemSetId, null)
  assert.deepEqual(merged.bank.questions.map((question) => question.text), [
    '原题', '无 ID 的题目', '新增题', '另一道无 ID 的题目'
  ])
  assert.deepEqual(merged.bank.questions.map((question) => question.number), [1, 2, 3, 4])
  assert.equal(merged.bank.questions[1].key === merged.bank.questions[3].key, false)
  assert.equal(merged.bank.totalScore, 14)
  assert.equal(merged.duplicateCount, 1)
  assert.equal(merged.answers.get('q-1')?.answer, 'A')
  assert.equal(merged.answers.get('q-3')?.answer, 'A')
  assert.throws(() => mergeQuestionBanks([{ bank: firstBank, answers: firstAnswers }]), /至少选择两个题库/)
})

test('shuffles a copy and creates a bounded random selection', () => {
  const source = [1, 2, 3]
  assert.deepEqual(shuffleQuestions(source, () => 0), [2, 3, 1])
  assert.deepEqual(source, [1, 2, 3])
  assert.equal(randomQuestionSet(source, 2, () => 0).length, 2)
  assert.deepEqual(randomQuestionSet([1, 2], 10, () => 0), [2, 1])
  assert.deepEqual(randomQuestionSet([1, 2], -1, () => 0), [])
})
