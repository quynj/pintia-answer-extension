export interface ReviewSubmission {
  answer: unknown;
  evaluation: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function extractSubmissionAnswer(detail: unknown): unknown {
  if (!isRecord(detail)) return undefined;
  const preferredKeys = ['answer', 'answers', 'code', 'sourceCode', 'submittedCode', 'content'];
  for (const key of preferredKeys) {
    if (detail[key] !== undefined && detail[key] !== null && detail[key] !== '') return detail[key];
  }
  for (const value of Object.values(detail)) {
    if (value && typeof value === 'object') {
      const answer = extractSubmissionAnswer(value);
      if (answer !== undefined) return answer;
    }
  }
  return undefined;
}

function evaluationOf(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase();
  if (/答案正确|^(CORRECT|ACCEPTED|ANSWER_CORRECT|RIGHT|SUCCESS)$/.test(text)) return 'correct';
  if (/答案错误|^(WRONG|WRONG_ANSWER|INCORRECT|ANSWER_WRONG|REJECTED)$/.test(text)) return 'wrong';
  return null;
}

export function submissionResults(data: unknown): Map<string, ReviewSubmission> {
  const root = asRecord(data);
  const nestedData = asRecord(root.data);
  const submission = asRecord(root.submission || nestedData.submission || root.data || root);
  const byProblemId = new Map<string, ReviewSubmission>();
  const submissionDetails = Array.isArray(submission.submissionDetails)
    ? submission.submissionDetails.filter(isRecord)
    : [];
  for (const detail of submissionDetails) {
    const problemId = String(detail.problemSetProblemId || detail.problemId || '');
    if (!problemId || problemId === '0') continue;
    const detailBody = Object.entries(detail).find(([key, value]) =>
      key.endsWith('SubmissionDetail') && value && typeof value === 'object')?.[1] || detail;
    byProblemId.set(problemId, {
      answer: extractSubmissionAnswer(detailBody),
      evaluation: null
    });
  }

  const inspectJudgments = (value: unknown, inheritedProblemId = ''): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => inspectJudgments(entry, inheritedProblemId));
      return;
    }
    if (!isRecord(value)) return;
    const problemId = String(value.problemSetProblemId || value.problemId || inheritedProblemId);
    const statuses = Object.entries(value)
      .filter(([key]) => /status|result|judge|message|content/i.test(key))
      .map(([, entry]) => typeof entry === 'object' ? '' : String(entry || ''));
    const evaluation = statuses.map(evaluationOf).find(Boolean);
    if (problemId && byProblemId.has(problemId) && evaluation) {
      const result = byProblemId.get(problemId);
      if (result) result.evaluation = evaluation;
    }
    Object.values(value).forEach((entry) => inspectJudgments(entry, problemId));
  };
  inspectJudgments(submission.judgeResponseContents);
  return byProblemId;
}
