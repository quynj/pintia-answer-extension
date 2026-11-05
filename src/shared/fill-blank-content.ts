import type { PintiaQuestion } from './types';

interface FillBlankConfig {
  blanks: Array<{ index: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFillBlankConfig(value: unknown): value is FillBlankConfig {
  return isRecord(value)
    && Array.isArray(value.blanks)
    && value.blanks.every((blank) => isRecord(blank) && typeof blank.index === 'number');
}

export function fillBlankMarkdownContent(
  question: PintiaQuestion,
  blankLabel: (index: number) => string = () => ' ________ '
): string {
  const apiData = isRecord(question.apiData) ? question.apiData : {};
  const apiProblemConfig = isRecord(apiData.problemConfig) ? apiData.problemConfig : {};
  const problemConfig = isRecord(question.problemConfig) ? question.problemConfig : {};
  const config = [
    apiProblemConfig.fillInTheBlankProblemConfig,
    apiProblemConfig.fillInTheBlankForProgrammingProblemConfig,
    problemConfig.fillInTheBlankProblemConfig,
    problemConfig.fillInTheBlankForProgrammingProblemConfig,
    question.fillBlankConfig
  ].find(isFillBlankConfig);
  const blanks = config?.blanks ?? [];
  if (!blanks.length) return question.content || question.prompt || '';
  const maxIndex = Math.max(...blanks.map((blank: { index: number }) => Number(blank.index)).filter(Number.isFinite));
  const sourceFields = isRecord(question.apiData)
    ? question.apiData
    : isRecord(question.questionText) ? question.questionText : {};
  const candidates = ['description', 'question', 'content', 'text', 'body', 'title']
    .map((field) => sourceFields[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().replace(/\n*填空位置：(?:_{2,}(?:、|$))+$/, ''));
  const fallback = (question.content || question.prompt || '').replace(/\n*填空位置：(?:_{2,}(?:、|$))+$/, '');
  if (fallback && !candidates.includes(fallback)) candidates.push(fallback);
  const rankedCandidates = candidates
    .map((value) => ({
      value,
      hasMarkers: /@@\s*\[\s*\]\s*\(\s*\d+\s*\)/.test(value),
      plainText: value.replace(/@@\s*\[\s*\]\s*\(\s*\d+\s*\)/g, '')
    }))
    .sort((left, right) => Number(right.hasMarkers) - Number(left.hasMarkers) || right.plainText.length - left.plainText.length);
  const isInsideMarkdownLink = (text: string, index: number): boolean => {
    const pattern = /!?\[[^\]]*\]\([^)]*\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (index > match.index && index < pattern.lastIndex) return true;
    }
    return false;
  };
  const selected = rankedCandidates.find(({ plainText }) => maxIndex <= plainText.length
    && blanks.every((blank: { index: number }) => Number.isInteger(Number(blank.index))
      && Number(blank.index) >= 0
      && Number(blank.index) <= plainText.length));
  if (!selected) {
    const text = rankedCandidates[0]?.plainText || fallback;
    return `${text}${text ? '\n\n' : ''}填空位置：${blanks.map((_blank: unknown, index: number) => blankLabel(index)).join('、')}`;
  }
  const text = selected.plainText;
  const indexes = blanks.map((blank) => blank.index).sort((left, right) => left - right);
  if (indexes.some((index) => isInsideMarkdownLink(text, index))) {
    return `${text}${text ? '\n\n' : ''}填空位置：${blanks.map((_blank: unknown, index: number) => blankLabel(index)).join('、')}`;
  }
  let cursor = 0;
  const parts: string[] = [];
  indexes.forEach((index: number, blankIndex: number) => {
    parts.push(text.slice(cursor, index), blankLabel(blankIndex));
    cursor = index;
  });
  parts.push(text.slice(cursor));
  return parts.join('');
}
