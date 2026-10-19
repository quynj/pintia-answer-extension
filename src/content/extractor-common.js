(() => {
  const api = window.PintiaExtractor = window.PintiaExtractor || {};

  api.cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  api.markdownImages = (value, location, optionIndex) => {
    const text = String(value || '');
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
          url = new URL(markdownPath).href;
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
    if (type.includes('MORE_THAN_ONE') || type.includes('MULTIPLE_CHOICE_MORE')) return 'multiple_choice';
    if (type === 'MULTIPLE_CHOICE' || type === 'SINGLE_CHOICE') return 'single_choice';
    if (type.includes('JUDGE') || type.includes('TRUE_FALSE') || type.includes('TRUEORFALSE') || type.includes('TRUE_OR_FALSE') || type.includes('BOOLEAN')) return 'true_false';
    if (type.includes('FILL') || type.includes('BLANK')) return 'fill_blank';
    if (type.includes('PROGRAM') || type.includes('CODE')) return 'programming';
    if (type.includes('SHORT') || type.includes('SUBJECTIVE')) return 'short_answer';
    if (options.length) return 'single_choice';
    return 'answer';
  };

  api.normalizeApiQuestion = (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const textFields = ['title', 'description', 'question', 'content', 'text', 'body'];
    const type = api.normalizeType(item.type || item.problem_type || item.problemType || item.question_type, []);
    const statement = type === 'programming'
      ? ['content', 'description', 'question', 'text', 'body'].map((field) => item[field]).find(Boolean)
      : textFields.map((field) => item[field]).find(Boolean);
    const promptSource = statement || item.title;
    const prompt = type === 'programming' ? String(promptSource || '').trim() : api.cleanText(promptSource);
    if (prompt.length < 2) return null;
    const choiceConfig = item.problemConfig?.multipleChoiceProblemConfig
      || item.problemConfig?.multipleChoiceMoreThanOneAnswerProblemConfig;
    const rawOptions = choiceConfig?.choices || item.options || item.choices || item.answers || item.items || [];
    const content = String(statement || item.title || '').trim();
    const options = [];
    const images = textFields.flatMap((field) => api.markdownImages(item[field], field));
    if (Array.isArray(rawOptions)) {
      rawOptions.forEach((option) => {
        const optionText = typeof option === 'object' ? option.content || option.text || option.label : option;
        const normalizedOption = api.cleanText(optionText);
        if (!normalizedOption) return;
        const optionIndex = options.push(normalizedOption) - 1;
        images.push(...api.markdownImages(optionText, 'option', optionIndex));
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
      ...(type === 'programming' ? { hasStatement: Boolean(statement) } : {}),
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