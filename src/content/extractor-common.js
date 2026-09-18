(() => {
  const api = window.PintiaExtractor = window.PintiaExtractor || {};

  api.cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  api.normalizeType = (value, options) => {
    const type = String(value || '').toUpperCase();
    if (type.includes('MORE_THAN_ONE') || type.includes('MULTIPLE_CHOICE_MORE')) return 'multiple_choice';
    if (type === 'MULTIPLE_CHOICE' || type === 'SINGLE_CHOICE') return 'single_choice';
    if (type.includes('JUDGE') || type.includes('TRUE_FALSE') || type.includes('TRUEORFALSE') || type.includes('TRUE_OR_FALSE') || type.includes('BOOLEAN')) return 'true_false';
    if (type.includes('FILL') || type.includes('BLANK')) return 'fill_blank';
    if (type.includes('PROGRAM') || type.includes('CODE')) return 'programming';
    if (type.includes('SHORT') || type.includes('SUBJECTIVE')) return 'short_answer';
    if (options.length) return 'single_choice';
    return 'unknown';
  };

  api.normalizeApiQuestion = (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const prompt = api.cleanText(item.title || item.description || item.question || item.content || item.text || item.body);
    if (prompt.length < 2) return null;
    const choiceConfig = item.problemConfig?.multipleChoiceProblemConfig;
    const rawOptions = choiceConfig?.choices || item.options || item.choices || item.answers || item.items || [];
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option) => api.cleanText(typeof option === 'object' ? option.content || option.text || option.label : option)).filter(Boolean)
      : [];
    return {
      id: item.id || item.problem_id || item.question_id || undefined,
      number: Number(item.number || item.index || item.problemPoolIndex || index + 1),
      type: api.normalizeType(item.type || item.problem_type || item.problemType || item.question_type, options),
      prompt,
      content: api.cleanText(item.content || item.description || item.question || item.text || item.body || item.title),
      options,
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