(() => {
  const api = window.PintiaAnswer = window.PintiaAnswer || {};

  function cleanText(value) {
    return String(value ?? '').trim();
  }

  function normalizeType(value) {
    const type = cleanText(value).toLowerCase();
    if (type === 'single_choice' || type === 'single-choice' || type === 'single') return 'single_choice';
    if (type === 'multiple_choice' || type === 'multiple-choice' || type === 'multiple') return 'multiple_choice';
    if (type === 'true_false' || type === 'true-false' || type === 'judge' || type === 'boolean') return 'true_false';
    if (type === 'fill_blank' || type === 'fill-blank' || type === 'blank') return 'fill_blank';
    if (type === 'programming' || type === 'code') return 'programming';
    if (type === 'short_answer' || type === 'short-answer' || type === 'subjective') return 'short_answer';
    return type || 'unknown';
  }

  function parseJsonText(text) {
    const source = cleanText(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(source);
    } catch (_error) {
      const match = source.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch (_nestedError) {
        return null;
      }
    }
  }

  function normalizeAnswer(answer, fallbackType = 'unknown') {
    if (Array.isArray(answer)) return answer.map(cleanText).filter(Boolean);
    if (typeof answer === 'boolean') return answer;
    if (answer === null || answer === undefined) return '';
    const value = cleanText(answer);
    if (normalizeType(fallbackType) === 'multiple_choice') {
      return value.split(/[,，、\s]+/).map(cleanText).filter(Boolean);
    }
    return value;
  }

  function normalizeOne(item, fallbackQuestion = {}) {
    if (!item || typeof item !== 'object') return null;
    const questionNumber = Number(item.questionNumber ?? item.number ?? fallbackQuestion.number);
    const type = normalizeType(item.type || fallbackQuestion.type);
    const answer = normalizeAnswer(item.answer, type);
    if (!Number.isFinite(questionNumber) && !fallbackQuestion.id) return null;
    return {
      questionId: item.questionId || item.id || fallbackQuestion.id,
      questionNumber: Number.isFinite(questionNumber) ? questionNumber : undefined,
      type,
      source: item.source || 'unknown',
      status: item.status || 'parsed',
      answer,
      rawText: cleanText(item.rawText || item.answer),
      confidence: item.confidence || 'unknown'
    };
  }

  api.parse = (text, questions = []) => {
    const parsed = typeof text === 'string' ? parseJsonText(text) : text;
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.answers) ? parsed.answers : [parsed]);
    return items.map((item) => {
      const fallback = questions.find((question) => Number(question.number) === Number(item?.questionNumber ?? item?.number));
      return normalizeOne(item, fallback);
    }).filter(Boolean);
  };

  api.normalize = normalizeOne;
})();
