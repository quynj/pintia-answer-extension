(() => {
  const legacyPrompt = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';
  const legacyPromptPrefix = '请根据题目信息直接给出最终答案，不要解释过程。\n输出格式必须严格遵守以下 JSON 规范：';

  globalThis.PintiaAiConfig = Object.freeze({
    defaults: Object.freeze({
      apiType: 'chat-completions',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash',
      prompt: globalThis.PintiaPrompt.systemPrompt,
      autoApplyAnswers: false,
      secondaryCheckEnabled: false,
      secondaryPrompt: '请以审慎、严谨的教师身份，先独立解答题目，再逐题复核第一阶段答案。请勿默认初稿正确；发现错误时予以修正，确认无误时予以保留。题目 ID、题号、题型及答案结构必须与输入一致。最终仅输出符合主提示词 JSON 契约的完整答案，不输出分析过程或 Markdown。',
      useSeparateVerifierConfig: false
    }),
    isLegacyPrompt(prompt) {
      return prompt === legacyPrompt || prompt?.startsWith(legacyPromptPrefix);
    }
  });
})();
