(() => {
  const legacyPrompt = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';
  const legacyPromptPrefix = '请根据题目信息直接给出最终答案，不要解释过程。\n输出格式必须严格遵守以下 JSON 规范：';
  const previousTypePrompt = `逐题解答输入题目，只返回合法 JSON，不要 Markdown 或其他文字。
格式：{"problemSetId":null,"answers":[{"questionNumber":1,"problemId":"题目ID","type":"MULTIPLE_CHOICE","answer":"B"}]}
规则：problemSetId、questionNumber、problemId、type 必须照输入原样返回；无题集 ID 或题号时填 null。不得编造、遗漏、增加、重排题目或修改 ID。
answer 类型：MULTIPLE_CHOICE 为单个选项字母字符串；MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER 为选项字母数组；TRUE_OR_FALSE 为 JSON 布尔值；FILL_IN_THE_BLANK 为按空位顺序排列的字符串数组，数组长度必须等于 fillBlankConfig.blanks 的数量；SUBJECTIVE 为字符串；PROGRAMMING 和 SQL_PROGRAMMING 均为包含完整代码的非空字符串，不要用 Markdown 代码围栏，并严格使用该题 programmingLanguage 字段指定的语言；其他 type 按题目要求作答。选择题选项按 options 顺序对应 A、B、C……。填空题应综合阅读 questionText 中所有字段；字段内容可能互补，也可能只有部分字段包含完整题干、图片说明或作答要求，不可只依据 prompt 或 content。images 中是从这些字段提取并转换后的图片 URL；fillBlankConfig.blanks 按 index 顺序对应答案数组。`;
  const previousFillBlankPrompt = `逐题解答输入题目，只返回合法 JSON，不要 Markdown 或其他文字。
格式：{"problemSetId":null,"answers":[{"questionNumber":1,"problemId":"题目ID","type":"MULTIPLE_CHOICE","answer":"B"}]}
规则：problemSetId、questionNumber、problemId、type 必须照输入题目原样返回，包括大小写和下划线；无题集 ID 或题号时填 null。不得将 type 改写为自定义题型名称，不得编造、遗漏、增加、重排题目或修改 ID。
题型与 answer 格式：MULTIPLE_CHOICE（单选题）为一个选项字母字符串；MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER（多选题）为选项字母数组；TRUE_OR_FALSE（判断题）为 JSON 布尔值；FILL_IN_THE_BLANK（填空题）为按空位顺序排列的字符串数组，数组长度必须等于 fillBlankConfig.blanks 的数量；SUBJECTIVE（主观题）为字符串；PROGRAMMING（编程题）和 SQL_PROGRAMMING（SQL 编程题）均为包含完整代码的非空字符串，不要用 Markdown 代码围栏，并严格使用该题 programmingLanguage 字段指定的语言。选项按 options 顺序对应 A、B、C……。其他 Pintia 题型原样返回输入的 type，并按题目要求作答。
填空题应综合阅读 questionText 中所有字段；字段内容可能互补，也可能只有部分字段包含完整题干、图片说明或作答要求，不可只依据 prompt 或 content。images 中是从这些字段提取并转换后的图片 URL；fillBlankConfig.blanks 按 index 顺序对应答案数组。`;
  const previousSecondaryPrompt = '请以审慎、严谨的教师身份，先独立解答题目，再逐题复核第一阶段答案。请勿默认初稿正确；发现错误时予以修正，确认无误时予以保留。题目 ID、题号、题型及答案结构必须与输入一致。最终仅输出符合主提示词 JSON 契约的完整答案，不输出分析过程或 Markdown。';

  globalThis.PintiaAiConfig = Object.freeze({
    defaults: Object.freeze({
      apiType: 'chat-completions',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash',
      prompt: globalThis.PintiaPrompt.systemPrompt,
      autoApplyAnswers: false,
      requestTimeoutSeconds: 60,
      diagnosticLoggingEnabled: false,
      secondaryCheckEnabled: false,
      secondaryPrompt: '请先独立解答题目，再逐题审查第一阶段答案；第一阶段答案不可信，不得直接照抄。确认无误时保留，发现错误时修正。必须完整保留每道题的 problemId、questionNumber、type（严格使用输入中的 Pintia 原始大写题型值）和顺序，不得漏题、重复或添加题目。MULTIPLE_CHOICE 的 answer 只能是一个选项标识（如 "A"）；MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER 的 answer 必须是选项标识数组（如 ["A", "C"]）；其他题型的 answer 格式遵循主回答提示词。严禁返回选项正文、选项内容、解释文字或“选项 A”等描述替代选项标识。最终只输出符合主回答提示词 JSON 契约的完整 JSON，不要输出分析过程、Markdown 或其他文字。',
      useSeparateVerifierConfig: false
    }),
    isLegacyPrompt(prompt) {
      return prompt === legacyPrompt
        || prompt?.startsWith(legacyPromptPrefix)
        || prompt?.startsWith('请根据提供的题目数据，逐题分析并给出答案。\n\n## 输出要求\n你必须严格按照以下 JSON 格式输出：');
    },
    isPreviousTypePrompt(prompt) {
      return prompt === previousTypePrompt || prompt === previousFillBlankPrompt;
    },
    isPreviousSecondaryPrompt(prompt) {
      return prompt === previousSecondaryPrompt;
    }
  });
})();
