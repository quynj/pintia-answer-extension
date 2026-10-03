(() => {
  const legacyPrompt = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';
  const legacyPromptPrefix = '请根据题目信息直接给出最终答案，不要解释过程。\n输出格式必须严格遵守以下 JSON 规范：';

  globalThis.PintiaAiConfig = Object.freeze({
    defaults: Object.freeze({
      apiType: 'chat-completions',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash',
      prompt: globalThis.PintiaPrompt.systemPrompt,
      autoApplyAnswers: false
    }),
    isLegacyPrompt(prompt) {
      return prompt === legacyPrompt || prompt?.startsWith(legacyPromptPrefix);
    }
  });
})();
