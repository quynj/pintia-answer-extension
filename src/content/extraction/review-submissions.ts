import { answerContract } from '../../shared/answer-contract';
import type { PintiaAnswerItem, PintiaQuestion } from '../../shared/types';

export interface ReviewSubmission {
  answer: unknown;
  evaluation: string | null;
}

export interface ReviewAnswerPayload {
  problemSetId: string;
  answers: PintiaAnswerItem[];
  skippedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function extractSubmissionAnswer(detail: unknown): unknown {
  if (!isRecord(detail)) return undefined;
  const preferredKeys = ['answer', 'answers', 'code', 'program', 'sourceCode', 'submittedCode', 'content'];
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

export function submissionResults(data: unknown, fallbackProblemId?: string): Map<string, ReviewSubmission> {
  const root = asRecord(data);
  const nestedData = asRecord(root.data);
  const submission = asRecord(root.submission || nestedData.submission || root.data || root);
  const byProblemId = new Map<string, ReviewSubmission>();
  const submissionDetails = Array.isArray(submission.submissionDetails)
    ? submission.submissionDetails.filter(isRecord)
    : [];
  for (const detail of submissionDetails) {
    const problemId = String(detail.problemSetProblemId || detail.problemId || fallbackProblemId || '');
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

function answerForType(type: string, answer: unknown): unknown {
  if (type === 'TRUE_OR_FALSE' && typeof answer === 'string') {
    const normalized = answer.trim().toUpperCase();
    if (normalized === 'TRUE') return true;
    if (normalized === 'FALSE') return false;
  }
  if ((type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER'
    || type === 'FILL_IN_THE_BLANK'
    || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') && typeof answer === 'string') {
    try {
      const parsed: unknown = JSON.parse(answer);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // A plain string is a valid single submitted choice or one blank answer.
    }
    return [answer];
  }
  return answer;
}

function fillBlankCount(question: PintiaQuestion): number | undefined {
  const config = question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
    ? question.apiData?.problemConfig?.fillInTheBlankForProgrammingProblemConfig
    : question.apiData?.problemConfig?.fillInTheBlankProblemConfig;
  return Array.isArray(config?.blanks) ? config.blanks.length : question.fillBlankCount;
}

export function reviewAnswerPayload(problemSetId: string, questions: PintiaQuestion[]): ReviewAnswerPayload {
  const answers: PintiaAnswerItem[] = [];
  const seenProblemIds = new Set<string>();
  let skippedCount = 0;
  for (const question of questions) {
    const problemId = question.id ?? question.problemId;
    const answer = question.submission?.answer;
    if (typeof problemId !== 'string' || !problemId || answer === undefined || answer === null || answer === '') {
      skippedCount += 1;
      continue;
    }
    if (seenProblemIds.has(problemId)) {
      skippedCount += 1;
      continue;
    }
    seenProblemIds.add(problemId);
    const questionNumber = question.number ?? question.questionNumber ?? null;
    const expectedBlankCount = fillBlankCount(question);
    const normalizedAnswer = answerForType(question.type, answer);
    if ((question.type === 'FILL_IN_THE_BLANK' || question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING')
      && Number.isInteger(expectedBlankCount)
      && Array.isArray(normalizedAnswer)
      && normalizedAnswer.length !== expectedBlankCount) {
      skippedCount += 1;
      continue;
    }
    const candidate = {
      questionNumber,
      problemId,
      type: question.type,
      answer: normalizedAnswer
    };
    try {
      const serialized = JSON.stringify({ problemSetId, answers: [candidate] });
      if (!serialized) throw new Error('answer is not serializable');
      answers.push(answerContract.parse(serialized, problemSetId, [{
        problemId,
        questionNumber,
        type: question.type,
        optionLabels: question.optionLabels,
        fillBlankCount: expectedBlankCount
      }]).answers[0]);
    } catch {
      skippedCount += 1;
    }
  }
  return { problemSetId, answers, skippedCount };
}
