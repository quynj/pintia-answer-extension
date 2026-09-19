const DEFAULT_CONFIG = {
  apiType: 'chat-completions',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-mini',
  prompt: `请根据题目信息直接给出最终答案，不要解释过程。
输出格式必须严格遵守以下 JSON 规范：
{
  "answers": [
    {
      "questionNumber": 1,
      "type": "single_choice",
      "answer": "B"
    }
  ]
}
单选题 answer 使用一个选项字母；多选题 answer 使用选项字母数组；判断题 answer 使用 true 或 false；填空题 answer 使用按输入框顺序排列的字符串数组；编程题和简答题 answer 使用字符串。只输出 JSON，不要 markdown，不要额外说明。`
};
const LEGACY_PROMPT = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';

function responseText(data, apiType) {
  if (apiType === 'chat-completions') {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.filter((item) => typeof item?.text === 'string').map((item) => item.text).join('\n') : '';
  }
  if (typeof data?.output_text === 'string') return data.output_text;
  return (data?.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' && item.text)
    .map((item) => item.text).join('\n');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get-ai-config') {
    chrome.storage.local.get({ aiConfig: DEFAULT_CONFIG }).then(({ aiConfig }) => sendResponse({ config: { ...DEFAULT_CONFIG, ...aiConfig } }));
    return true;
  }
  if (message.type !== 'ask-ai') return false;
  (async () => {
    const { aiConfig } = await chrome.storage.local.get({ aiConfig: DEFAULT_CONFIG });
    if (!aiConfig?.apiKey) throw new Error('请先在 AI 配置中填写 API Key');
    const apiType = aiConfig.apiType || (aiConfig.endpoint?.includes('/responses') ? 'responses' : 'chat-completions');
    const systemPrompt = aiConfig.prompt === LEGACY_PROMPT ? DEFAULT_CONFIG.prompt : (aiConfig.prompt || DEFAULT_CONFIG.prompt);
    const requestBody = apiType === 'chat-completions'
      ? {
        model: aiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.input }
        ]
      }
      : { model: aiConfig.model, instructions: systemPrompt, input: message.input };
    const response = await fetch(aiConfig.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${aiConfig.apiKey}` },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `模型请求失败（${response.status}）`);
    const text = responseText(data, apiType);
    if (!text) throw new Error('模型没有返回可读答案');
    sendResponse({ text });
  })().catch((error) => sendResponse({ error: error.message || '模型请求失败' }));
  return true;
});