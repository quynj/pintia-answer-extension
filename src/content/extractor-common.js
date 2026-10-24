(() => {
  const api = window.PintiaExtractor = window.PintiaExtractor || {};

  api.cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  api.normalizeRichText = (value) => String(value || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const attribute = (name) => {
      const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(/&amp;/g, '&');
    };
    const source = attribute('src');
    if (!source) return tag;
    const alt = attribute('alt');
    return `![${alt}](<${source}>)`;
  });

  api.fillBlankMarkdownContent = (question, blankLabel = () => ' ________ ') => {
    const config = question.apiData?.problemConfig?.fillInTheBlankProblemConfig
      || question.apiData?.problemConfig?.fillInTheBlankForProgrammingProblemConfig
      || question.problemConfig?.fillInTheBlankProblemConfig
      || question.problemConfig?.fillInTheBlankForProgrammingProblemConfig
      || question.fillBlankConfig;
    const blanks = Array.isArray(config?.blanks) ? config.blanks : [];
    if (!blanks.length) return question.content || question.prompt || '';
    const maxIndex = Math.max(...blanks.map((blank) => Number(blank.index)).filter(Number.isFinite));
    const sourceFields = question.apiData || question.questionText || {};
    const candidates = ['description', 'question', 'content', 'text', 'body', 'title']
      .map((field) => sourceFields[field])
      .filter((value) => typeof value === 'string' && value.trim())
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
    const isInsideMarkdownLink = (text, index) => {
      const pattern = /!?\[[^\]]*\]\([^)]*\)/g;
      let match;
      while ((match = pattern.exec(text))) {
        if (index > match.index && index < pattern.lastIndex) return true;
      }
      return false;
    };
    const selected = rankedCandidates.find(({ plainText }) => maxIndex <= plainText.length
      && blanks.every((blank) => Number.isInteger(Number(blank.index))
        && Number(blank.index) >= 0
        && Number(blank.index) <= plainText.length));
    if (!selected) {
      const text = rankedCandidates[0]?.plainText || fallback;
      return `${text}${text ? '\n\n' : ''}填空位置：${blanks.map((_, index) => blankLabel(index)).join('、')}`;
    }
    const text = selected.plainText;
    const indexes = blanks.map((blank) => Number(blank.index)).sort((left, right) => left - right);
    if (indexes.some((index) => isInsideMarkdownLink(text, index))) {
      return `${text}${text ? '\n\n' : ''}填空位置：${blanks.map((_, index) => blankLabel(index)).join('、')}`;
    }
    let cursor = 0;
    const parts = [];
    indexes.forEach((index, blankIndex) => {
      parts.push(text.slice(cursor, index), blankLabel(blankIndex));
      cursor = index;
    });
    parts.push(text.slice(cursor));
    return parts.join('');
  };

  api.markdownImages = (value, location, optionIndex) => {
    const text = api.normalizeRichText(value);
    const images = [];
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
  };

  api.normalizeType = (value, options) => {
    const type = String(value || '').toUpperCase();
    if (type === 'SINGLE_CHOICE') return 'MULTIPLE_CHOICE';
    if (type === 'TRUE_FALSE' || type === 'TRUEORFALSE' || type === 'JUDGE' || type === 'BOOLEAN') return 'TRUE_OR_FALSE';
    if (!type && options.length) return 'MULTIPLE_CHOICE';
    return type || 'NO_PROBLEM_TYPE';
  };

  api.normalizeApiQuestion = (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const textFields = ['title', 'description', 'question', 'content', 'text', 'body'];
    const type = api.normalizeType(item.type || item.problem_type || item.problemType || item.question_type, []);
    const isProgramming = type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING';
    const isListBackedProblem = isProgramming || type === 'SUBJECTIVE';
    const isFillInTheBlank = type === 'FILL_IN_THE_BLANK'
      || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING';
    const fillBlankConfig = item.problemConfig?.fillInTheBlankProblemConfig
      || item.problemConfig?.fillInTheBlankForProgrammingProblemConfig;
    const statement = isListBackedProblem
      ? ['description', 'question', 'text', 'body', 'content', 'title'].map((field) => item[field]).find(Boolean)
      : textFields.map((field) => item[field]).find(Boolean);
    const textValues = textFields
      .map((field) => ({ field, value: api.normalizeRichText(item[field]) }))
      .filter(({ value }, index, values) => value.trim() && values.findIndex((entry) => entry.value === value) === index);
    let content = api.normalizeRichText(statement || item.title).trim();
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
      const blankCount = fillBlankConfig?.blanks?.length || 0;
      const blankTokens = content.match(/@@\s*\[\s*\]\s*\(\s*\d+\s*\)/g) || [];
      const inputTokens = content.match(/<input\b[^>]*>/gi) || [];
      const visibleBlankCount = blankTokens.length || inputTokens.length || (content.match(/_+/g) || []).length;
      if (blankCount > visibleBlankCount) {
        const missingBlanks = Array(blankCount - visibleBlankCount).fill('________').join('、');
        content = `${content}${content ? '\n\n' : ''}填空位置：${missingBlanks}`;
      }
    }
    const promptSource = isFillInTheBlank ? content : statement || item.title;
    const prompt = isListBackedProblem ? String(promptSource || '').trim() : api.cleanText(promptSource);
    if (prompt.length < 2) return null;
    const choiceConfig = item.problemConfig?.multipleChoiceProblemConfig
      || item.problemConfig?.multipleChoiceMoreThanOneAnswerProblemConfig;
    const rawOptions = isFillInTheBlank
      ? []
      : choiceConfig?.choices || item.options || item.choices || item.answers || item.items || [];
    const options = [];
    const images = textFields.flatMap((field) => api.markdownImages(item[field], field));
    if (Array.isArray(rawOptions)) {
      rawOptions.forEach((option) => {
        const optionText = typeof option === 'object' ? option.content || option.text || option.label : option;
        const normalizedOptionText = api.normalizeRichText(optionText);
        const normalizedOption = api.cleanText(normalizedOptionText);
        if (!normalizedOption || options.includes(normalizedOption)) return;
        const optionIndex = options.push(normalizedOption) - 1;
        images.push(...api.markdownImages(normalizedOptionText, 'option', optionIndex));
      });
    }
    const rawNumber = item.number ?? item.index ?? item.problemPoolIndex;
    const number = rawNumber === undefined || rawNumber === null || rawNumber === '' ? undefined : Number(rawNumber);
    return {
      id: item.id || item.problem_id || item.question_id || undefined,
      number: Number.isFinite(number) ? number : undefined,
      type: api.normalizeType(item.type || item.problem_type || item.problemType || item.question_type, options),
      prompt,
      content,
      ...(isListBackedProblem ? { hasStatement: Boolean(statement) } : {}),
      ...(item.title ? { title: String(item.title) } : {}),
      options,
      images,
      score: item.score || item.point || undefined,
      apiData: item
    };
  };

  api.uniqueQuestions = (questions) => questions
    .filter((item, index, list) => list.findIndex((other) => item.id || other.id ? item.id && other.id === item.id : other.prompt === item.prompt) === index)
    .map(({ id, ...item }) => ({ ...(id ? { id } : {}), ...item }));

  api.findApiQuestionArrays = (value, found = []) => {
    if (!value || typeof value !== 'object') return found;
    if (Array.isArray(value)) {
      const questions = value.map(api.normalizeApiQuestion).filter(Boolean);
      if (questions.length) found.push(questions);
      value.forEach((entry) => api.findApiQuestionArrays(entry, found));
      return found;
    }
    Object.values(value).forEach((entry) => api.findApiQuestionArrays(entry, found));
    return found;
  };

  api.problemSetProblems = (data) => {
    if (Array.isArray(data?.problemSetProblems)) return data.problemSetProblems.map(api.normalizeApiQuestion).filter(Boolean);
    return api.findApiQuestionArrays(data).flat();
  };
})();