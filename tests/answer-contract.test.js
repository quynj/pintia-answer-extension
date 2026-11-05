import assert from 'node:assert/strict';
import test from 'node:test';
import { answerContract } from '../src/shared/answer-contract.ts';

test('parses valid answers and preserves the payload', () => {
  const payload = {
    problemSetId: 'set-1',
    answers: [
      { problemId: 'question-1', questionNumber: 1, type: 'MULTIPLE_CHOICE', answer: 'B' },
      { problemId: 'question-2', questionNumber: 2, type: 'TRUE_OR_FALSE', answer: false }
    ]
  };

  assert.deepEqual(answerContract.parse(JSON.stringify(payload), 'set-1'), payload);
});

test('rejects duplicate IDs and invalid answer shapes', () => {
  assert.throws(() => answerContract.validate({
    problemSetId: null,
    answers: [
      { problemId: 'duplicate', questionNumber: 1, type: 'SUBJECTIVE', answer: 'one' },
      { problemId: 'duplicate', questionNumber: 2, type: 'SUBJECTIVE', answer: 'two' }
    ]
  }), /problemId 重复/);

  assert.throws(() => answerContract.validate({
    problemSetId: null,
    answers: [{ problemId: 'question-1', questionNumber: 1, type: 'TRUE_OR_FALSE', answer: 'true' }]
  }), /判断答案必须是布尔值/);
});

test('enforces expected question identity, order, and choice labels', () => {
  const expectedQuestions = [
    { problemId: 'question-1', questionNumber: 1, type: 'MULTIPLE_CHOICE', optionLabels: ['A', 'B'] }
  ];
  assert.throws(() => answerContract.validate({
    problemSetId: null,
    answers: [{ problemId: 'question-1', questionNumber: 1, type: 'MULTIPLE_CHOICE', answer: 'C' }]
  }, null, expectedQuestions), /有效选项标识/);
});
