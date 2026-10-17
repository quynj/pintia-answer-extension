(() => {
  const api = globalThis.PintiaPrompt = globalThis.PintiaPrompt || {};

  const outputRules = `逐题解答输入题目，只返回合法 JSON，不要 Markdown 或其他文字。
格式：{"problemSetId":null,"answers":[{"questionNumber":1,"problemId":"题目ID","type":"single_choice","answer":"B"}]}
规则：problemSetId、questionNumber、problemId、type 必须照输入原样返回；无题集 ID 或题号时填 null。不得编造、遗漏、增加、重排题目或修改 ID。
answer 类型：single_choice 为一个选项字母字符串；multiple_choice 为选项字母数组；true_false 为 JSON 布尔值；fill_blank 为按空位顺序排列的字符串数组，数组长度必须等于 fillBlankConfig.blanks 的数量；short_answer 为字符串；programming 为包含完整源代码的非空字符串，不要用 Markdown 代码围栏，并严格使用该题 programmingLanguage 字段指定的语言；answer 按题目要求作答。选择题选项按 options 顺序对应 A、B、C……。填空题应综合阅读 questionText 中所有字段；字段内容可能互补，也可能只有部分字段包含完整题干、图片说明或作答要求，不可只依据 prompt 或 content。images 中是从这些字段提取并转换后的图片 URL；fillBlankConfig.blanks 按 index 顺序对应答案数组。`;

  api.systemPrompt = outputRules;

  api.buildInput = (title, questions, problemSetId, programmingLanguage) => {
    const questionData = {
      problemSetId: problemSetId ?? null,
      questions: questions.map((question) => {
        const fillBlankConfig = question.apiData?.problemConfig?.fillInTheBlankProblemConfig
          ?? question.problemConfig?.fillInTheBlankProblemConfig;
        const rawProgrammingConfig = question.apiData?.problemConfig?.programmingProblemConfig
          ?? question.problemConfig?.programmingProblemConfig;
        const questionText = ['title', 'description', 'question', 'content', 'text', 'body']
          .reduce((fields, name) => {
            const value = question.apiData?.[name] ?? (name === 'content' ? question.content : undefined);
            if (typeof value === 'string' && value.trim()) fields[name] = value;
            return fields;
          }, {});
        return {
          questionNumber: question.number ?? null,
          problemId: question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id ?? null,
          type: question.type,
          ...(question.title ? { title: question.title } : {}),
          prompt: question.type === 'programming' ? question.title || question.prompt : question.prompt,
          ...(question.type === 'programming' ? {
            content: question.content || question.apiData?.content || question.apiData?.description || question.prompt,
            ...(programmingLanguage ? {
              programmingLanguage,
              languageInstruction: `请使用 ${programmingLanguage} 编写完整可运行的源代码。不要改用其他语言，也不要输出 Markdown 代码围栏。`
            } : {}),
            ...(rawProgrammingConfig ? {
              programmingConfig: {
                ...(rawProgrammingConfig.timeLimit === undefined ? {} : { timeLimit: rawProgrammingConfig.timeLimit }),
                ...(rawProgrammingConfig.memoryLimit === undefined ? {} : { memoryLimit: rawProgrammingConfig.memoryLimit }),
                ...(rawProgrammingConfig.codeSizeLimit === undefined ? {} : { codeSizeLimit: rawProgrammingConfig.codeSizeLimit }),
                ...(rawProgrammingConfig.exampleTestDatas ? { exampleTestDatas: rawProgrammingConfig.exampleTestDatas } : {}),
                ...(rawProgrammingConfig.testdataDescriptionCode
                  ? { testdataDescriptionCode: rawProgrammingConfig.testdataDescriptionCode }
                  : {})
              }
            } : {}),
            ...(question.apiData?.compiler ? { compiler: question.apiData.compiler } : {})
          } : {}),
          ...(question.type === 'fill_blank' ? {
            content: question.content || question.apiData?.content || question.prompt,
            questionText,
            ...(fillBlankConfig ? { fillBlankConfig } : {})
          } : {}),
          options: question.options || [],
          optionLabels: (question.options || []).length <= 26
            ? (question.options || []).map((_, index) => String.fromCharCode(65 + index))
            : [],
          images: (question.images || []).map(({ url, location, optionIndex }) => ({
            url,
            location,
            ...(optionIndex === undefined ? {} : { optionIndex })
          }))
        };
      })
    };
    return [
      `题库：${title || 'Pintia 题库'}`,
      JSON.stringify(questionData)
    ].join('\n');
  };

  api.build = (title, questions, problemSetId, prompt = outputRules, programmingLanguage) =>
    `${api.buildInput(title, questions, problemSetId, programmingLanguage)}\n\n${prompt}`;
})();
