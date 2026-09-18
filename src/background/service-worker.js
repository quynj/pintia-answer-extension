const DEFAULT_CONFIG = {
  apiType: 'chat-completions',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-mini',
  prompt: '请逐题只输出最终答案，不要解析过程。选择题只输出选项，判断题只输出判断结果，填空题只输出填空内容，编程题只输出可提交的代码。'
};

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
    const requestBody = apiType === 'chat-completions'
      ? {
        model: aiConfig.model,
        messages: [
          { role: 'system', content: aiConfig.prompt },
          { role: 'user', content: message.input }
        ]
      }
      : { model: aiConfig.model, instructions: aiConfig.prompt, input: message.input };
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