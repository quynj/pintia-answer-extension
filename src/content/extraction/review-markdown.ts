import { extractorApi } from './extractor-common';
import { questionTypes } from '../question-types';
import type { PintiaQuestion, PintiaQuestionBankResult, PintiaReviewMarkdownApi } from '../../shared/types';

interface QuestionContent {
  text: string;
  source: 'content' | 'normalized-content' | 'apiData.description' | 'prompt' | 'title';
}

interface RenderedQuestionContent {
  text: string;
  hasInlineOptions?: boolean;
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown, type: string): string {
  let text = extractorApi.normalizeRichText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/\\_{2,}\\_/g, '____');
  if (type === 'SQL_PROGRAMMING') {
    text = text.replace(/^\s*这是一个SQL编程题模板[。.!！]?\s*/i, '');
    text = text.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '请在这里写定义表结构的SQL语句。'
        && trimmed !== '请在这里给出输出样例。';
    }).join('\n');
  }
  text = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    return !/^这是(?:一个|一道).*(?:题的样例|题样例).*$/.test(trimmed)
      && !/^这是一道填空题模板[。.!！]?$/.test(trimmed)
      && !/^这是一个主观题模板。请在这里写题目描述[。.!！]?$/.test(trimmed)
      && !/^请在这里写题目描述[。.!！…]*$/.test(trimmed);
  }).join('\n');
  return text.replace(/\n*填空位置：(?:_{2,}(?:、|$))+$/, '').trim();
}

function questionContent(question: PintiaQuestion): QuestionContent | null {
  const apiData = isRecord(question.apiData) ? question.apiData : {};
  const contentSource = typeof apiData.content === 'string'
    ? 'content'
    : isRecord(question.apiData) ? 'normalized-content' : 'content';
  const candidates: Array<{ source: QuestionContent['source']; value: unknown }> = [
    { source: contentSource, value: typeof apiData.content === 'string' ? apiData.content : question.content },
    { source: 'apiData.description', value: apiData.description },
    { source: 'prompt', value: question.prompt },
    { source: 'title', value: question.title }
  ];
  for (const candidate of candidates) {
    if (typeof candidate.value !== 'string') continue;
    if (!normalizedText(candidate.value, question.type)) continue;
    return { text: candidate.value, source: candidate.source };
  }
  return null;
}

function blankConfig(question: PintiaQuestion): unknown[] {
  const apiData = isRecord(question.apiData) ? question.apiData : {};
  const apiProblemConfig = isRecord(apiData.problemConfig) ? apiData.problemConfig : {};
  const problemConfig = isRecord(question.problemConfig) ? question.problemConfig : {};
  const configName = question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
    ? 'fillInTheBlankForProgrammingProblemConfig'
    : 'fillInTheBlankProblemConfig';
  const candidates = [
    apiProblemConfig[configName],
    problemConfig[configName],
    question.fillBlankConfig
  ];
  const config = candidates.find((candidate) => isRecord(candidate) && Array.isArray(candidate.blanks));
  return isRecord(config) && Array.isArray(config.blanks) ? config.blanks : [];
}

function insideMarkdownLink(text: string, index: number): boolean {
  const pattern = /!?\[[^\]]*\]\([^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (index > match.index && index < pattern.lastIndex) return true;
  }
  return false;
}

function fillBlankContent(
  text: string,
  question: PintiaQuestion,
  source: QuestionContent['source']
): { text: string; warning?: string } {
  if (question.type !== 'FILL_IN_THE_BLANK' && question.type !== 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
    return { text };
  }

  const placeholder = ' ________ ';
  const blanks = blankConfig(question);
  const markedBlank = /(?:\[填空\s*\d+\]|【填空\s*\d+】)/g;
  const markedBlanks = text.match(markedBlank);
  if (markedBlanks) {
    return {
      text: text.replace(markedBlank, placeholder),
      ...(blanks.length && markedBlanks.length !== blanks.length
        ? { warning: '题干填空标记数量与配置不一致，请复核。' }
        : {})
    };
  }
  const platformBlank = /@@\s*\[\s*\]\s*\(\s*\d+\s*\)|<input\b[^>]*>/gi;
  const platformBlanks = text.match(platformBlank);
  if (platformBlanks) {
    return {
      text: text.replace(platformBlank, placeholder),
      ...(blanks.length && platformBlanks.length !== blanks.length
        ? { warning: '题干填空标记数量与配置不一致，请复核。' }
        : {})
    };
  }

  if (!blanks.length) return { text };
  const orderedIndexes = blanks.map((blank, order) => ({
    index: isRecord(blank) ? blank.index : undefined,
    order
  })).flatMap(({ index, order }) =>
    typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= text.length
      ? [{ index, order }]
      : []
  ).sort((left, right) => left.index - right.index || left.order - right.order);
  if (source === 'content' && orderedIndexes.length === blanks.length) {
    if (!orderedIndexes.some(({ index }) => insideMarkdownLink(text, index))) {
      let cursor = 0;
      const parts: string[] = [];
      orderedIndexes.forEach(({ index }) => {
        parts.push(text.slice(cursor, index), placeholder);
        cursor = index;
      });
      parts.push(text.slice(cursor));
      return { text: parts.join('') };
    }
  }
  const positions = blanks.map(() => placeholder.trim()).join('、');
  return {
    text: `${text}${text ? '\n\n' : ''}填空位置暂无法还原：${positions}`,
    warning: '空位原位置无法可靠还原，已将占位符列在题干末尾。'
  };
}

function expandedImageMarkdown(value: unknown): string {
  return String(value || '').replace(/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)\s*(\))/g, (match, prefix, source, suffix) => {
    const imagePath = source.replace(/^<|>$/g, '');
    if (!/^\/?~\//.test(imagePath)) return match;
    const path = imagePath.replace(/^\/?~\//, '').split('/').map(encodeURIComponent).join('/');
    return `${prefix}<https://images.ptausercontent.com/${path}>${suffix}`;
  });
}

function imageIsPresent(text: string, image: { url: string; markdownPath: string }): boolean {
  return text.includes(image.url) || text.includes(image.markdownPath);
}

function hasInlineOptions(content: string, options: string[]): boolean {
  if (!content || !options.length) return false;
  const lines = content.trimEnd().split('\n').slice(-options.length);
  return lines.length === options.length && lines.every((line, index) => {
    const match = line.match(/^\s*([A-Z])[.)]\s*(.*)$/);
    if (match?.[1] !== String.fromCharCode(65 + index)) return false;
    const optionText = (value: string) => normalizedText(
      value.replace(/!\[[^\]]*\]\(\s*(?:<[^>]+>|[^)\s]+)\s*\)/g, ''),
      ''
    ).trim();
    return optionText(match[2]) === optionText(options[index]);
  });
}

function inlineOptionsWithImages(content: string, question: PintiaQuestion): string {
  const options = question.options || [];
  if (!hasInlineOptions(content, options)) return content;
  const lines = content.split('\n');
  const firstOptionLine = lines.length - options.length;
  options.forEach((_option, optionIndex) => {
    const lineIndex = firstOptionLine + optionIndex;
    const optionImages = (question.images || [])
      .filter((image) =>
        image.location === 'option'
        && image.optionIndex === optionIndex
        && !imageIsPresent(lines[lineIndex], image)
      )
      .map((image) => `![选项图片](<${image.url}>)`);
    if (optionImages.length) lines[lineIndex] += ` ${optionImages.join(' ')}`;
  });
  return lines.join('\n');
}

function questionMarkdown(question: PintiaQuestion): RenderedQuestionContent {
  const selected = questionContent(question);
  if (!selected) return { text: '', warning: '未找到可用题干内容，请回到题目来源复核。' };
  const prepared = fillBlankContent(selected.text, question, selected.source);
  const content = expandedImageMarkdown(normalizedText(prepared.text, question.type));
  const includesOptions = hasInlineOptions(content, question.options || []);
  const contentWithOptionImages = inlineOptionsWithImages(content, question);
  const contentImages = [...new Set((question.images || [])
    .filter((image) => image.location !== 'option' && image.url && !imageIsPresent(contentWithOptionImages, image))
    .map((image) => image.url))];
  const warnings = [
    prepared.warning,
    ...(selected.source === 'title' ? ['题干使用标题回退，建议复核完整性。'] : [])
  ].filter((warning): warning is string => Boolean(warning));
  return {
    text: [contentWithOptionImages, ...contentImages.map((url) => `![题目图片](<${url}>)`)]
      .filter(Boolean)
      .join('\n\n'),
    ...(includesOptions ? { hasInlineOptions: true } : {}),
    ...(warnings.length ? { warning: warnings.join(' ') } : {})
  };
}

function answerText(answer: unknown): string {
  if (answer === undefined || answer === null || answer === '') return '（未提供作答内容）';
  if (Array.isArray(answer)) return answer.map((item) => String(item)).join('、');
  if (typeof answer === 'object') return JSON.stringify(answer) ?? String(answer);
  return String(answer);
}

function codeFence(value: string): string {
  const longest = Math.max(0, ...(String(value).match(/`+/g) || []).map((part) => part.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${value}\n${fence}`;
}

function questionOption(question: PintiaQuestion, option: string, optionIndex: number): string {
  const optionText = expandedImageMarkdown(normalizedText(option, ''));
  const optionImages = (question.images || [])
    .filter((image) => image.location === 'option' && image.optionIndex === optionIndex && !imageIsPresent(optionText, image))
    .map((image) => `![选项图片](<${image.url}>)`);
  return `${String.fromCharCode(65 + optionIndex)}. ${[optionText, ...optionImages].filter(Boolean).join(' ')}`;
}

function summariesMarkdown(summaries: Record<string, unknown> | undefined): string[] {
  if (!summaries) return [];
  const entries = Object.entries(summaries).flatMap(([type, value]) => {
    if (!isRecord(value) || typeof value.total !== 'number') return [];
    return [`${questionTypes.labels[type] || type} ${value.total} 道`];
  });
  return entries.length ? [`- 题型概览：${entries.join('；')}`] : [];
}

function render(result: PintiaQuestionBankResult, includeAnswers = true): string {
  const questionsByType = new Map<string, PintiaQuestion[]>();
  result.questions.forEach((question) => {
    const type = question.type;
    if (!questionsByType.has(type)) questionsByType.set(type, []);
    questionsByType.get(type)?.push(question);
  });
  const title = result.problemSetName || result.title || 'Pintia 复习题库';
  const lines = [
    `# ${title}`,
    '',
    `- 导出时间：${new Date().toLocaleString()}`,
    ...(result.source ? [`- 来源：${result.source}`] : []),
    `- 题目数：${result.questions.length}`,
    ...summariesMarkdown(result.summaries),
    '',
    `> 说明：只展示平台返回的评测状态${includeAnswers ? '和作答' : ''}；未评测或无法识别的状态不会推断为正确或错误。`,
    ''
  ];
  for (const [type, questions] of questionsByType) {
    lines.push(`## ${questionTypes.labels[type] || type}`, '');
    questions.forEach((question, index) => {
      const submission = question.submission;
      const evaluation = submission?.evaluation;
      const mark = evaluation === 'wrong' ? '❌ 错题' : evaluation === 'correct' ? '✅ 正确' : '⚪ 未评测/未知';
      lines.push(`### ${question.number ?? index + 1}. ${mark}`, '');
      const rendered = questionMarkdown(question);
      lines.push(rendered.text, '');
      if (rendered.warning) lines.push(`> ⚠️ ${rendered.warning}`, '');
      if (question.options?.length && !rendered.hasInlineOptions) {
        lines.push(...question.options.map((option, optionIndex) => questionOption(question, option, optionIndex)), '');
      }
      if (includeAnswers) {
        const answer = answerText(submission?.answer);
        lines.push(`**我的作答：** ${question.type === 'PROGRAMMING' || question.type === 'SQL_PROGRAMMING'
          ? `\n\n${codeFence(answer)}`
          : answer}`);
      }
      if (evaluation === 'wrong') lines.push('', '**错题标记：** 平台未提供可用标准答案');
      else if (!submission) lines.push('', '**作答记录：** 未找到匹配的提交记录');
      lines.push('');
    });
  }
  return lines.join('\n');
}

function filename(result: PintiaQuestionBankResult): string {
  const safeName = (result.problemSetName || result.title || 'pintia-review')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80) || 'pintia-review';
  return `${safeName}.md`;
}

export const reviewMarkdown: PintiaReviewMarkdownApi = { render, filename };
