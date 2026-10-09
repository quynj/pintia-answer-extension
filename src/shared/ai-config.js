(() => {
  const legacyPrompt = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';
  const legacyPromptPrefix = '请根据题目信息直接给出最终答案，不要解释过程。\n输出格式必须严格遵守以下 JSON 规范：';
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
      secondaryPrompt: '请先独立解答题目，再逐题审查第一阶段答案；第一阶段答案不可信，不得直接照抄。确认无误时保留，发现错误时修正。必须完整保留每道题的 problemId、questionNumber、type 和顺序，不得漏题、重复或添加题目。单选题的 answer 只能是一个选项标识（如 "A"），多选题的 answer 必须是选项标识数组（如 ["A", "C"]）；严禁返回选项正文、选项内容、解释文字或“选项 A”等描述替代选项标识。最终只输出符合主回答提示词 JSON 契约的完整 JSON，不要输出分析过程、Markdown 或其他文字。',
      useSeparateVerifierConfig: false
    }),
    isLegacyPrompt(prompt) {
      return prompt === legacyPrompt
        || prompt?.startsWith(legacyPromptPrefix)
        || prompt?.startsWith('请根据提供的题目数据，逐题分析并给出答案。\n\n## 输出要求\n你必须严格按照以下 JSON 格式输出：');
    },
    isPreviousSecondaryPrompt(prompt) {
      return prompt === previousSecondaryPrompt;
    }
  });
})();
