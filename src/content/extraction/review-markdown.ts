import { extractorApi } from './extractor-common';
import { questionTypes } from '../question-types';
import type { PintiaQuestion, PintiaQuestionBankResult, PintiaReviewMarkdownApi } from '../../shared/types';

  function expandedImageMarkdown(value: unknown): string {
    return String(value || '').replace(/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)\s*(\))/g, (match, prefix, source, suffix) => {
      const imagePath = source.replace(/^<|>$/g, '');
      if (!/^\/?~\//.test(imagePath)) return match;
      const path = imagePath.replace(/^\/?~\//, '').split('/').map(encodeURIComponent).join('/');
      return `${prefix}<https://images.ptausercontent.com/${path}>${suffix}`;
    });
  }

  function questionMarkdown(question: PintiaQuestion): string {
    const questionContent = question.type === 'FILL_IN_THE_BLANK'
      || question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
      ? extractorApi.fillBlankMarkdownContent(question)
      : question.content || question.prompt;
    const content = expandedImageMarkdown(questionContent);
    const imageUrls = [...new Set((question.images || [])
      .filter((image) => image.location !== 'option' && image.url && !content.includes(image.url))
      .map((image) => image.url))];
    return [content, ...imageUrls.map((url) => `![题目图片](<${url}>)`)]
      .filter(Boolean)
      .join('\n\n');
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

  function render(result: PintiaQuestionBankResult, includeAnswers = true): string {
    const questionsByType = new Map<string, PintiaQuestion[]>();
    result.questions.forEach((question) => {
      const type = question.type;
      if (!questionsByType.has(type)) questionsByType.set(type, []);
      questionsByType.get(type)?.push(question);
    });
    const lines = [
      `# ${result.title}`,
      '',
      `- 导出时间：${new Date().toLocaleString()}`,
      `- 来源：${result.source}`,
      `- 题目数：${result.questions.length}`,
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
        lines.push(questionMarkdown(question), '');
        if (question.options?.length) {
          lines.push(...question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${expandedImageMarkdown(option)}`), '');
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
    const safeName = (result.title || 'pintia-review')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80) || 'pintia-review';
    return `${safeName}.md`;
  }

export const reviewMarkdown: PintiaReviewMarkdownApi = { render, filename };
