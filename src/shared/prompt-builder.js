(() => {
  const api = globalThis.PintiaPrompt = globalThis.PintiaPrompt || {};

  const outputRules = `逐题解答输入题目，只返回合法 JSON，不要 Markdown 或其他文字。
格式：{"problemSetId":null,"answers":[{"questionNumber":1,"problemId":"题目ID","type":"single_choice","answer":"B"}]}
规则：problemSetId、questionNumber、problemId、type 必须照输入原样返回；无题集 ID 或题号时填 null。不得编造、遗漏、增加、重排题目或修改 ID。
answer 类型：single_choice 为一个选项字母字符串；multiple_choice 为选项字母数组；true_false 为 JSON 布尔值；fill_blank 为按空位顺序排列的字符串数组；short_answer 为字符串；programming 和 answer 按题目要求作答。选择题选项按 options 顺序对应 A、B、C……。`;

  api.systemPrompt = outputRules;

  api.buildInput = (title, questions, problemSetId) => {
    const questionData = {
      problemSetId: problemSetId ?? null,
      questions: questions.map((question) => ({
        questionNumber: question.number ?? null,
        problemId: question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id ?? null,
        type: question.type,
        prompt: question.prompt,
        options: question.options || [],
        optionLabels: (question.options || []).length <= 26
          ? (question.options || []).map((_, index) => String.fromCharCode(65 + index))
          : [],
        images: (question.images || []).map(({ url, location, optionIndex }) => ({
          url,
          location,
          ...(optionIndex === undefined ? {} : { optionIndex })
        }))
      }))
    };
    return [
      `题库：${title || 'Pintia 题库'}`,
      JSON.stringify(questionData)
    ].join('\n');
  };

  api.build = (title, questions, problemSetId, prompt = outputRules) =>
    `${api.buildInput(title, questions, problemSetId)}\n\n${prompt}`;
})();
