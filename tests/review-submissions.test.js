import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewAnswerPayload, submissionResults } from '../src/content/extraction/review-submissions.ts';

test('associates returned answers with recognized evaluation statuses', () => {
  const results = submissionResults({
    data: {
      submission: {
        submissionDetails: [
          {
            problemSetProblemId: 'question-1',
            multipleChoiceSubmissionDetail: { answer: 'B' }
          },
          {
            problemSetProblemId: 'question-2',
            programmingSubmissionDetail: { sourceCode: 'print(1)' }
          }
        ],
        judgeResponseContents: [
          { problemSetProblemId: 'question-1', status: 'CORRECT' },
          { problemSetProblemId: 'question-2', message: '答案错误' }
        ]
      }
    }
  });

  test('associates a list-backed question submission when the API omits its question ID', () => {
    const results = submissionResults({
      submission: {
        submissionDetails: [
          { programmingSubmissionDetail: { sourceCode: 'print(1)' } }
        ]
      }
    }, 'program-question-1');

    assert.deepEqual(results.get('program-question-1'), { answer: 'print(1)', evaluation: null });
  });

  assert.deepEqual(results.get('question-1'), { answer: 'B', evaluation: 'correct' });
  assert.deepEqual(results.get('question-2'), { answer: 'print(1)', evaluation: 'wrong' });
});

test('extracts programming source from the Pintia program field for list-backed questions', () => {
  const results = submissionResults({
    submission: {
      submissionDetails: [
        {
          problemSetProblemId: 'program-question',
          programmingSubmissionDetail: { compiler: 'JAVAC', program: 'class Main {}' }
        }
      ]
    }
  }, 'program-question');

  assert.deepEqual(results.get('program-question'), { answer: 'class Main {}', evaluation: null });
  const payload = reviewAnswerPayload('set-1', [{
    id: 'program-question',
    type: 'PROGRAMMING',
    submission: results.get('program-question')
  }]);

  assert.deepEqual(payload.answers.map(({ answer }) => answer), ['class Main {}']);
});

test('extracts SQL source from the Pintia program field', () => {
  const results = submissionResults({
    submission: {
      submissionDetails: [
        {
          problemSetProblemId: 'sql-question',
          problemId: '0',
          sqlProgrammingSubmissionDetail: {
            program: 'select f_name from fruits order by f_name'
          }
        }
      ]
    }
  }, 'sql-question');

  assert.deepEqual(results.get('sql-question'), {
    answer: 'select f_name from fruits order by f_name',
    evaluation: null
  });
  const payload = reviewAnswerPayload('set-1', [{
    id: 'sql-question',
    type: 'SQL_PROGRAMMING',
    submission: results.get('sql-question')
  }]);

  assert.deepEqual(payload.answers.map(({ answer }) => answer), [
    'select f_name from fruits order by f_name'
  ]);
});

test('builds a reusable answer JSON payload from recent submissions across question types', () => {
  const result = reviewAnswerPayload('set-1', [
    { id: 'choice', type: 'MULTIPLE_CHOICE', number: 1, submission: { answer: 'B' } },
    { id: 'multi', type: 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER', number: 2, submission: { answer: '["A","C"]' } },
    { id: 'boolean', type: 'TRUE_OR_FALSE', number: 3, submission: { answer: 'FALSE' } },
    { id: 'blank', type: 'FILL_IN_THE_BLANK', number: 4, submission: { answer: 'Java' } },
    { id: 'program-blank', type: 'FILL_IN_THE_BLANK_FOR_PROGRAMMING', number: 5, submission: { answer: ['left', 'right'] } },
    { id: 'program', type: 'PROGRAMMING', number: 6, submission: { answer: 'print(1)\n' } },
    { id: 'sql', type: 'SQL_PROGRAMMING', number: 7, submission: { answer: 'SELECT 1;' } },
    { id: 'subjective', type: 'SUBJECTIVE', number: 8, submission: { answer: 'My response' } },
    { id: 'missing', type: 'MULTIPLE_CHOICE' }
  ]);

  assert.equal(result.problemSetId, 'set-1');
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.answers.map(({ answer }) => answer), [
    'B',
    ['A', 'C'],
    false,
    ['Java'],
    ['left', 'right'],
    'print(1)\n',
    'SELECT 1;',
    'My response'
  ]);
  assert.deepEqual(result.answers.map(({ type }) => type), [
    'MULTIPLE_CHOICE',
    'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
    'TRUE_OR_FALSE',
    'FILL_IN_THE_BLANK',
    'FILL_IN_THE_BLANK_FOR_PROGRAMMING',
    'PROGRAMMING',
    'SQL_PROGRAMMING',
    'SUBJECTIVE'
  ]);
});

test('skips recent answers that cannot satisfy the answer JSON contract', () => {
  const result = reviewAnswerPayload('set-2', [
    { id: 'invalid-blank', type: 'FILL_IN_THE_BLANK', submission: { answer: { value: 'no' } } },
    {
      id: 'incomplete-program-blank',
      type: 'FILL_IN_THE_BLANK_FOR_PROGRAMMING',
      apiData: { problemConfig: { fillInTheBlankForProgrammingProblemConfig: { blanks: [{ index: 0 }, { index: 1 }] } } },
      submission: { answer: ['only one'] }
    },
    { id: 'valid-code', type: 'PROGRAMMING', submission: { answer: 'print(2)' } }
  ]);

  assert.equal(result.skippedCount, 2);
  assert.deepEqual(result.answers.map(({ problemId }) => problemId), ['valid-code']);
});
