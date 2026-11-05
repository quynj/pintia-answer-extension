import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionResults } from '../src/content/extraction/review-submissions.ts';

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

  assert.deepEqual(results.get('question-1'), { answer: 'B', evaluation: 'correct' });
  assert.deepEqual(results.get('question-2'), { answer: 'print(1)', evaluation: 'wrong' });
});
