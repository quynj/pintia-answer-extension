(() => {
  const api = globalThis.PintiaAnswerContract = globalThis.PintiaAnswerContract || {};

  api.validate = (payload, expectedProblemSetId, expectedQuestions) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('答案必须是 JSON 对象。');
    }
    if (payload.problemSetId !== null && typeof payload.problemSetId !== 'string') {
      throw new Error('problemSetId 必须是字符串或 null。');
    }
    if (expectedProblemSetId && payload.problemSetId && payload.problemSetId !== expectedProblemSetId) {
      throw new Error('答案中的 problemSetId 与当前题集不匹配。');
    }
    if (!Array.isArray(payload.answers)) throw new Error('answers 必须是数组。');

    const seenProblemIds = new Set();
    payload.answers.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`answers[${index}] 必须是对象。`);
      }
      if (typeof item.problemId !== 'string' || !item.problemId.trim()) {
        throw new Error(`answers[${index}].problemId 必须是非空字符串。`);
      }
      if (seenProblemIds.has(item.problemId)) {
        throw new Error(`problemId 重复：${item.problemId}`);
      }
      seenProblemIds.add(item.problemId);
      if (typeof item.type !== 'string' || !item.type) {
        throw new Error(`answers[${index}].type 必须是非空字符串。`);
      }
      if (item.questionNumber !== null && typeof item.questionNumber !== 'number') {
        throw new Error(`answers[${index}].questionNumber 必须是数字或 null。`);
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'answer')) {
        throw new Error(`answers[${index}] 缺少 answer。`);
      }

      if (item.type === 'MULTIPLE_CHOICE' && (typeof item.answer !== 'string' || !item.answer)) {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的单选答案必须是非空字符串。`);
      }
      if (item.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER' && (!Array.isArray(item.answer)
        || item.answer.some((option) => typeof option !== 'string' || !option)
        || new Set(item.answer).size !== item.answer.length)) {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的多选答案必须是无重复字符串数组。`);
      }
      if (item.type === 'TRUE_OR_FALSE' && typeof item.answer !== 'boolean') {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的判断答案必须是布尔值。`);
      }
      if (item.type === 'FILL_IN_THE_BLANK' && (!Array.isArray(item.answer)
        || item.answer.some((value) => typeof value !== 'string'))) {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的填空答案必须是字符串数组。`);
      }
      if ((item.type === 'PROGRAMMING' || item.type === 'SQL_PROGRAMMING')
        && (typeof item.answer !== 'string' || !item.answer.trim())) {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的编程答案必须是非空字符串。`);
      }
      if (item.type === 'SUBJECTIVE' && typeof item.answer !== 'string') {
        throw new Error(`题目 ${item.questionNumber ?? index + 1} 的主观题答案必须是字符串。`);
      }
    });

    if (expectedQuestions) {
      if (payload.answers.length !== expectedQuestions.length) {
        throw new Error('复核结果的题目数量与输入不一致。');
      }
      const answersById = new Map(payload.answers.map((item) => [item.problemId, item]));
      expectedQuestions.forEach((question, index) => {
        if (typeof question.problemId !== 'string' || !question.problemId) {
          throw new Error('输入题目缺少可校验的题目 ID。');
        }
        const answer = answersById.get(question.problemId);
        if (!answer) throw new Error(`复核结果遗漏题目 ${question.questionNumber ?? question.problemId}。`);
        if (payload.answers[index]?.problemId !== question.problemId) {
          throw new Error('复核结果的题目顺序与输入不一致。');
        }
        if (answer.questionNumber !== question.questionNumber || answer.type !== question.type) {
          throw new Error(`复核结果中的题目 ${question.questionNumber ?? question.problemId} 信息与输入不一致。`);
        }
        if (question.optionLabels?.length) {
          const validLabels = new Set(question.optionLabels);
          const choices = answer.type === 'MULTIPLE_CHOICE' ? [answer.answer]
            : answer.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER' ? answer.answer
              : [];
          if (choices.some((choice) => !validLabels.has(choice))) {
            throw new Error(`题目 ${question.questionNumber ?? question.problemId} 的选择题答案必须使用有效选项标识：${question.optionLabels.join('、')}。`);
          }
        }
      });
    }
    return payload;
  };

  api.parse = (text, expectedProblemSetId, expectedQuestions) => {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error('JSON 格式无效，请检查答案文本。');
    }
    return api.validate(payload, expectedProblemSetId, expectedQuestions);
  };
})();
