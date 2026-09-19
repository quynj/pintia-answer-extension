(() => {
  const api = window.PintiaPrompt = window.PintiaPrompt || {};

  const outputRules = `请根据题目信息直接给出最终答案，不要解释过程。\n输出格式必须严格遵守以下 JSON 规范：\n{\n  "answers": [\n    {\n      "questionNumber": 1,\n      "type": "single_choice",\n      "answer": "B"\n    }\n  ]\n}\n单选题 answer 使用一个选项字母；多选题 answer 使用选项字母数组；判断题 answer 使用 true 或 false；填空题 answer 使用按输入框顺序排列的字符串数组；编程题和简答题 answer 使用字符串。只输出 JSON，不要 markdown，不要额外说明。`;

  api.systemPrompt = outputRules;

  api.build = (title, questions) => {
    const questionData = questions.map((question) => ({
      questionNumber: question.number,
      type: question.type,
      prompt: question.prompt,
      options: question.options || [],
      data: question.apiData || question
    }));
    return [
      `题库：${title || 'Pintia 题库'}`,
      '',
      '请回答以下题目：',
      JSON.stringify(questionData, null, 2),
      '',
      outputRules
    ].join('\n');
  };
})();
