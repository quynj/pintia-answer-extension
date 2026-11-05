import { fillBlankMarkdownContent } from '../../shared/fill-blank-content';
import type { PintiaExtractorCommonApi, PintiaImage, PintiaQuestion } from '../../shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRichText(value: unknown): string {
  return String(value || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const attribute = (name: string) => {
      const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(/&amp;/g, '&');
    };
    const source = attribute('src');
    if (!source) return tag;
    const alt = attribute('alt');
    return `![${alt}](<${source}>)`;
  });
}

function markdownImages(value: unknown, location: string, optionIndex?: number): PintiaImage[] {
  const text = normalizeRichText(value);
  const images: PintiaImage[] = [];
  const pattern = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const markdownPath = match[2].replace(/^<|>$/g, '');
    let url = markdownPath;
    if (markdownPath.startsWith('~/')) {
      const path = markdownPath.slice(2).split('/').map(encodeURIComponent).join('/');
      url = `https://images.ptausercontent.com/${path}`;
    } else {
      try {
        url = new URL(markdownPath, globalThis.location?.origin).href;
      } catch (_) {
        continue;
      }
    }
    images.push({
      url,
      markdownPath,
      location,
      index: match.index,
      ...(optionIndex === undefined ? {} : { optionIndex })
    });
  }
  return images;
}

function normalizeType(value: unknown, options?: string[]): string {
  const type = String(value || '').toUpperCase();
  if (type === 'SINGLE_CHOICE') return 'MULTIPLE_CHOICE';
  if (type === 'TRUE_FALSE' || type === 'TRUEORFALSE' || type === 'JUDGE' || type === 'BOOLEAN') return 'TRUE_OR_FALSE';
  if (!type && options?.length) return 'MULTIPLE_CHOICE';
  return type || 'NO_PROBLEM_TYPE';
}

function normalizeApiQuestion(item: unknown, index: number): PintiaQuestion | null {
  if (!isRecord(item)) return null;
  const textFields = ['content', 'description', 'question', 'text', 'body', 'title'];
  const type = normalizeType(item.type || item.problem_type || item.problemType || item.question_type, []);
  const isProgramming = type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING';
  const isListBackedProblem = isProgramming || type === 'SUBJECTIVE';
  const isFillInTheBlank = type === 'FILL_IN_THE_BLANK'
    || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING';
  const problemConfig = isRecord(item.problemConfig) ? item.problemConfig : {};
  const blankConfigCandidate = problemConfig.fillInTheBlankProblemConfig
    || problemConfig.fillInTheBlankForProgrammingProblemConfig;
  const fillBlankConfig = isRecord(blankConfigCandidate) ? blankConfigCandidate : null;
  const statement = isListBackedProblem
    ? ['description', 'question', 'text', 'body', 'content', 'title'].map((field) => item[field]).find(Boolean)
    : textFields.map((field) => item[field]).find(Boolean);
  const textValues = textFields
    .map((field) => ({ field, value: normalizeRichText(item[field]) }))
    .filter(({ value }, valueIndex, values) => value.trim() && values.findIndex((entry) => entry.value === value) === valueIndex);
  let content = normalizeRichText(statement || item.title).trim();
  if (isFillInTheBlank) {
    const blankMarker = /@@\s*\[\s*\]\s*\(\s*\d+\s*\)|<input\b|data-blank-index/i;
    const contentSource = textValues
      .filter(({ value }) => blankMarker.test(value))
      .sort((left, right) => right.value.length - left.value.length)[0]
      || textValues.find(({ field }) => field === 'description')
      || textValues.find(({ field }) => field === 'question')
      || textValues.find(({ field }) => field === 'content')
      || textValues[0];
    content = (contentSource?.value || '').trim().replace(/<input\b[^>]*>/gi, '________');
    const blankCount = Array.isArray(fillBlankConfig?.blanks) ? fillBlankConfig.blanks.length : 0;
    const blankTokens = content.match(/@@\s*\[\s*\]\s*\(\s*\d+\s*\)/g) || [];
    const inputTokens = content.match(/<input\b[^>]*>/gi) || [];
    const visibleBlankCount = blankTokens.length || inputTokens.length || (content.match(/_+/g) || []).length;
    if (blankCount > visibleBlankCount) {
      const missingBlanks = Array(blankCount - visibleBlankCount).fill('________').join('、');
      content = `${content}${content ? '\n\n' : ''}填空位置：${missingBlanks}`;
    }
  }
  const promptSource = isFillInTheBlank ? content : statement || item.title;
  const prompt = isListBackedProblem ? String(promptSource || '').trim() : cleanText(promptSource);
  if (prompt.length < 2) return null;
  const choiceConfigCandidate = problemConfig.multipleChoiceProblemConfig
    || problemConfig.multipleChoiceMoreThanOneAnswerProblemConfig;
  const choiceConfig = isRecord(choiceConfigCandidate) ? choiceConfigCandidate : null;
  const rawOptions = isFillInTheBlank
    ? []
    : choiceConfig?.choices || item.options || item.choices || item.answers || item.items || [];
  const options: string[] = [];
  const images = textFields.flatMap((field) => markdownImages(item[field], field));
  if (Array.isArray(rawOptions)) {
    rawOptions.forEach((option) => {
      const optionText = isRecord(option) ? option.content || option.text || option.label : option;
      const normalizedOptionText = normalizeRichText(optionText);
      const normalizedOption = cleanText(normalizedOptionText);
      if (!normalizedOption || options.includes(normalizedOption)) return;
      const optionIndex = options.push(normalizedOption) - 1;
      images.push(...markdownImages(normalizedOptionText, 'option', optionIndex));
    });
  }
  const rawNumber = item.number ?? item.index ?? item.problemPoolIndex;
  const number = rawNumber === undefined || rawNumber === null || rawNumber === '' ? undefined : Number(rawNumber);
  const rawId = item.id ?? item.problem_id ?? item.question_id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
  return {
    id,
    number: Number.isFinite(number) ? number : undefined,
    type: normalizeType(item.type || item.problem_type || item.problemType || item.question_type, options),
    prompt,
    content,
    ...(isListBackedProblem ? { hasStatement: Boolean(statement) } : {}),
    ...(item.title ? { title: String(item.title) } : {}),
    options,
    images,
    score: item.score || item.point || undefined,
    apiData: item
  };
}

function uniqueQuestions(questions: Array<PintiaQuestion | null>): PintiaQuestion[] {
  return questions
    .filter((item): item is PintiaQuestion => item !== null)
    .filter((item, index, list) => list.findIndex((other) => item.id || other.id ? item.id && other.id === item.id : other.prompt === item.prompt) === index)
    .map(({ id, ...item }) => ({ ...(id ? { id } : {}), ...item }));
}

function findApiQuestionArrays(value: unknown, found: PintiaQuestion[][] = []): PintiaQuestion[][] {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    const questions = value
      .map(normalizeApiQuestion)
      .filter((question): question is PintiaQuestion => question !== null);
    if (questions.length) found.push(questions);
    value.forEach((entry) => findApiQuestionArrays(entry, found));
    return found;
  }
  Object.values(value).forEach((entry) => findApiQuestionArrays(entry, found));
  return found;
}

function problemSetProblems(data: unknown): PintiaQuestion[] {
  if (isRecord(data) && Array.isArray(data.problemSetProblems)) {
    return data.problemSetProblems
      .map(normalizeApiQuestion)
      .filter((question): question is PintiaQuestion => question !== null);
  }
  return findApiQuestionArrays(data).flat();
}

export const extractorApi: PintiaExtractorCommonApi = {
  cleanText,
  normalizeRichText,
  fillBlankMarkdownContent,
  markdownImages,
  normalizeType,
  normalizeApiQuestion,
  uniqueQuestions,
  findApiQuestionArrays,
  problemSetProblems
};
