import assert from 'node:assert/strict';
import test from 'node:test';
import { pintiaExtractor } from '../src/content/extraction/api-extractor.ts';

const problemSetId = '2119080236219047936';
const examId = '2125778248639754240';
const problemType = 'FILL_IN_THE_BLANK_FOR_PROGRAMMING';
const problemIds = [
  '2119080236256796672',
  '2119080236256796673',
  '2119080236256796674'
];
const answers = [
  ['list-style', 'repeat-x', 'float'],
  ['4px', 'float', 'background'],
  ['*', 'list-style', 'font-family']
];

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' }
  });
}

async function extractWithEndpoint(collectionReturnsQuestions) {
  const originals = new Map(
    ['fetch', 'location', 'chrome'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  const requestedUrls = [];

  globalThis.location = new URL(`https://pintia.cn/problem-sets/${problemSetId}/exam/overview`);
  globalThis.chrome = {
    runtime: {
      sendMessage(_message, callback) {
        callback({ entries: {} });
      }
    }
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    if (url.pathname.endsWith('/problem-summaries')) {
      return jsonResponse({ summaries: { [problemType]: { total: problemIds.length } } });
    }
    if (url.pathname.endsWith('/exam-problems')) {
      return jsonResponse({
        total: collectionReturnsQuestions ? problemIds.length : 0,
        problemSetProblems: collectionReturnsQuestions
          ? problemIds.map((id, index) => ({
            id,
            title: `program fill ${index + 1}`,
            type: problemType
          }))
          : []
      });
    }
    if (url.pathname.endsWith('/exam-problem-list')) {
      return jsonResponse({
        total: problemIds.length,
        problemSetProblems: problemIds.map((id, index) => ({
          id,
          title: `program fill ${index + 1}`,
          type: problemType,
          problemPoolIndex: index + 1
        }))
      });
    }
    if (/\/exam-problems\/[^/]+$/.test(url.pathname)) {
      const problemId = url.pathname.split('/').at(-1);
      const index = problemIds.indexOf(problemId);
      return jsonResponse({
        problemSetProblem: {
          id: problemId,
          title: `program fill ${index + 1}`,
          type: problemType
        }
      });
    }
    if (url.pathname.endsWith('/last-submissions')) {
      return jsonResponse({
        submission: {
          submissionDetails: problemIds.map((problemSetProblemId, index) => ({
            problemSetProblemId,
            problemId: '0',
            fillInTheBlankForProgrammingSubmissionDetail: { answers: answers[index] }
          }))
        }
      });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };

  try {
    const result = await pintiaExtractor.extractProblemSetForReview({
      id: problemSetId,
      name: '程序填空题测试',
      examId
    }, 0);
    return { result, requestedUrls };
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('extracts program fill questions from either endpoint and batches latest submissions', async () => {
  for (const collectionReturnsQuestions of [true, false]) {
    const { result, requestedUrls } = await extractWithEndpoint(collectionReturnsQuestions);
    const submissionRequests = requestedUrls.filter((url) => url.pathname.endsWith('/last-submissions'));

    assert.deepEqual(result.questions.map((question) => question.id), problemIds);
    assert.deepEqual(result.questions.map((question) => question.submission?.answer), answers);
    assert.equal(submissionRequests.length, 1);
    assert.equal(submissionRequests[0].searchParams.get('problem_type'), problemType);
    assert.equal(submissionRequests[0].searchParams.has('problem_set_problem_id'), false);

    assert.equal(
      requestedUrls.some((url) => url.pathname.endsWith('/exam-problem-list')),
      !collectionReturnsQuestions
    );
    assert.equal(
      requestedUrls.filter((url) => /\/exam-problems\/[^/]+$/.test(url.pathname)).length,
      collectionReturnsQuestions ? 0 : problemIds.length
    );
  }
});
