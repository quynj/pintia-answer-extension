(() => {
  const api = globalThis.PintiaPrompt = globalThis.PintiaPrompt || {};

  const outputRules = `逐题解答输入题目，只返回合法 JSON，不要 Markdown 或其他文字。
格式：{"problemSetId":null,"answers":[{"questionNumber":1,"problemId":"题目ID","type":"MULTIPLE_CHOICE","answer":"B"}]}
规则：problemSetId、questionNumber、problemId、type 必须照输入题目原样返回，包括大小写和下划线；无题集 ID 或题号时填 null。不得将 type 改写为自定义题型名称，不得编造、遗漏、增加、重排题目或修改 ID。
题型与 answer 格式：MULTIPLE_CHOICE（单选题）为一个选项字母字符串；MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER（多选题）为选项字母数组；TRUE_OR_FALSE（判断题）为 JSON 布尔值；FILL_IN_THE_BLANK（填空题）为按空位顺序排列的字符串数组，数组长度必须等于 fillBlankConfig.blanks 的数量；SUBJECTIVE（主观题）为字符串；PROGRAMMING（编程题）和 SQL_PROGRAMMING（SQL 编程题）均为包含完整代码的非空字符串，不要用 Markdown 代码围栏，并严格使用该题 programmingLanguage 字段指定的语言。选项按 options 顺序对应 A、B、C……。其他 Pintia 题型原样返回输入的 type，并按题目要求作答。
填空题使用 content 中按序编号的【填空1】、【填空2】等标记作为空位位置和顺序依据；answer 数组必须按这些编号顺序作答，并与 fillBlankConfig.blanks 数量一致。fillBlankConfig.blanks 已按原始 index 顺序排列，每项的 number 与 content 标记对应，不要再按 questionText 中缺失空位的字段重新推断位置。questionText 中的原始字段仅作为补充上下文，可能缺少空位或包含模板说明；images 中是从这些字段提取并转换后的图片 URL。`;

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
        const isProgramming = question.type === 'PROGRAMMING' || question.type === 'SQL_PROGRAMMING';
        const isFillInTheBlank = question.type === 'FILL_IN_THE_BLANK';
        const orderedFillBlankConfig = fillBlankConfig ? {
          ...fillBlankConfig,
          blanks: [...(fillBlankConfig.blanks || [])]
            .sort((left, right) => Number(left.index) - Number(right.index))
            .map(({ index, ...blank }, blankIndex) => ({
              ...blank,
              number: blankIndex + 1
            }))
        } : undefined;
        const fillBlankContent = isFillInTheBlank
          ? globalThis.PintiaExtractor.fillBlankMarkdownContent(
            question,
            (blankIndex) => `【填空${blankIndex + 1}】`
          )
          : null;
        return {
          questionNumber: question.number ?? null,
          problemId: question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id ?? null,
          type: question.type,
          ...(question.title ? { title: question.title } : {}),
          prompt: isFillInTheBlank
            ? fillBlankContent
            : isProgramming ? question.title || question.prompt : question.prompt,
          ...(isProgramming ? {
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
          ...(isFillInTheBlank ? {
            content: fillBlankContent,
            questionText,
            ...(orderedFillBlankConfig ? { fillBlankConfig: orderedFillBlankConfig } : {})
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
