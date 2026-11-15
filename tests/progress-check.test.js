import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateQuestionProgress,
  examResponseData,
  isPastProgressDeadline,
  parsePintiaTimestamp,
  problemStatusById,
  problemStatusEntriesFromResponse,
  progressDeadline,
  progressDeadlineFromExamResponse,
  serverTimeFromResponse
} from '../src/content/extraction/progress-check.ts';

test('counts submitted, wrong, and accepted questions as answered', () => {
  const progress = calculateQuestionProgress([
    { id: 'submitted', problemStatus: 'PROBLEM_SUBMITTED' },
    { id: 'wrong', problemStatus: 'PROBLEM_WRONG_ANSWER' },
    { id: 'accepted', problemStatus: 'PROBLEM_ACCEPTED' },
    { id: 'not-answered', problemStatus: 'PROBLEM_NO_ANSWER' }
  ]);

  assert.deepEqual(progress, { completed: 3, total: 4, percentage: 75 });
});

test('parses problem-status API records using problemSubmissionStatus', () => {
  const entries = problemStatusEntriesFromResponse({
    problemStatus: [
      { id: 'one', problemSubmissionStatus: 'PROBLEM_ACCEPTED' },
      { id: 'two', problemSubmissionStatus: 'PROBLEM_WRONG_ANSWER' },
      { id: 'three', problemSubmissionStatus: 'PROBLEM_NO_ANSWER' }
    ]
  });
  assert.deepEqual(calculateQuestionProgress(entries), { completed: 2, total: 3, percentage: 66 });
  assert.deepEqual(problemStatusById(entries), new Map([
    ['one', 'PROBLEM_ACCEPTED'],
    ['two', 'PROBLEM_WRONG_ANSWER'],
    ['three', 'PROBLEM_NO_ANSWER']
  ]));
});

test('deduplicates consistent question IDs and rejects conflicting or incomplete statuses', () => {
  assert.deepEqual(calculateQuestionProgress([
    { id: 'same', status: 'PROBLEM_ACCEPTED' },
    { problemSetProblemId: 'same', problemStatus: { status: 'PROBLEM_ACCEPTED' } }
  ]), { completed: 1, total: 1, percentage: 100 });

  assert.throws(() => calculateQuestionProgress([
    { id: 'same', status: 'PROBLEM_ACCEPTED' },
    { id: 'same', status: 'PROBLEM_NO_ANSWER' }
  ]), /状态不一致/);
  assert.throws(() => calculateQuestionProgress([{ id: 'missing' }]), /状态缺失/);
  assert.throws(() => calculateQuestionProgress([{ status: 'PROBLEM_ACCEPTED' }]), /缺少题目 ID/);
  assert.throws(() => calculateQuestionProgress([{ id: 'unknown', status: 'UNKNOWN' }]), /无法识别/);
  assert.throws(() => calculateQuestionProgress([]), /为空/);
});

test('parses timezone-aware timestamps and uses the exam deadline before set fallbacks', () => {
  assert.equal(parsePintiaTimestamp('2026-11-14T02:00:00Z'), Date.UTC(2026, 10, 14, 2));
  assert.equal(parsePintiaTimestamp('2026-11-14T02:00:00'), null);
  assert.equal(parsePintiaTimestamp('Sat, 14 Nov 2026 03:00:00 GMT'), Date.UTC(2026, 10, 14, 3));
  assert.equal(parsePintiaTimestamp('not-a-date'), null);
  assert.equal(
    progressDeadline('2026-11-14T02:00:00Z', '2026-11-15T02:00:00Z', '2026-11-16T02:00:00Z'),
    Date.UTC(2026, 10, 14, 2)
  );
  assert.equal(progressDeadline(undefined, '2026-11-15T02:00:00Z', null), Date.UTC(2026, 10, 15, 2));
  assert.equal(progressDeadline('invalid', '2026-11-15T02:00:00Z', null), null);
});

test('uses problemSet.endAt when the exam response has no exam object', () => {
  const response = {
    serverTime: '2026-11-14T03:47:18.532650804Z',
    problemSet: {
      startAt: '2026-11-11T00:20:00Z',
      endAt: '2026-11-11T01:50:19Z'
    }
  };
  assert.deepEqual(examResponseData({ data: { data: response } }), response);
  assert.equal(
    progressDeadlineFromExamResponse(response, null),
    Date.UTC(2026, 10, 11, 1, 50, 19)
  );
  assert.equal(
    isPastProgressDeadline(
      progressDeadlineFromExamResponse(response, null) ?? 0,
      serverTimeFromResponse(response, null) ?? 0
    ),
    true
  );
});

test('prefers server-provided time and can use the HTTP Date header', () => {
  assert.equal(
    serverTimeFromResponse({ data: { serverTime: '2026-11-14T02:00:00Z' } }, 'Sat, 14 Nov 2026 03:00:00 GMT'),
    Date.UTC(2026, 10, 14, 2)
  );
  assert.equal(
    serverTimeFromResponse({}, 'Sat, 14 Nov 2026 03:00:00 GMT'),
    Date.UTC(2026, 10, 14, 3)
  );
  assert.equal(serverTimeFromResponse({}, null), null);
});

test('treats the exact deadline as expired using server time', () => {
  const deadline = Date.UTC(2026, 10, 14, 2);
  assert.equal(isPastProgressDeadline(deadline, deadline - 1), false);
  assert.equal(isPastProgressDeadline(deadline, deadline), true);
  assert.equal(isPastProgressDeadline(deadline, deadline + 1), true);
});

