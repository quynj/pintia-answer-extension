importScripts('../shared/prompt-builder.js', '../shared/ai-config.js');

const { defaults, isLegacyPrompt } = globalThis.PintiaAiConfig;

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function getAiConfig() {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  const config = { ...defaults, ...aiConfig };
  if (!aiConfig?.apiType && aiConfig?.endpoint?.includes('/responses')) config.apiType = 'responses';
  if (isLegacyPrompt(config.prompt)) config.prompt = defaults.prompt;
  return config;
}

async function saveAiConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('AI 配置格式无效。');
  const endpoint = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  if (!config.model?.trim()) throw new Error('请填写模型名称。');
  if (!config.apiKey?.trim()) throw new Error('请填写 API Key。');
  if (!['chat-completions', 'responses'].includes(config.apiType)) throw new Error('API 类型无效。');

  const savedConfig = {
    apiType: config.apiType,
    endpoint: endpoint.href,
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
    prompt: config.prompt?.trim() || defaults.prompt,
    autoApplyAnswers: config.autoApplyAnswers === true
  };
  await chrome.storage.local.set({ aiConfig: savedConfig });
  return savedConfig;
}

async function getQuestionBank(sender) {
  const tabId = sender.tab?.id;
  if (!tabId || !sender.tab.url?.startsWith('https://pintia.cn/')) {
    throw new Error('请在 Pintia 题目页面中导出题库。');
  }
  const result = await sendTabMessage(tabId, { type: 'export' });
  if (result?.error) throw new Error(result.error);
  if (!result?.questions?.length) throw new Error('当前页面没有可导出的题目。');
  return { result };
}

function responseText(data, apiType) {
  if (apiType === 'chat-completions') {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    return Array.isArray(content)
      ? content.filter((item) => typeof item?.text === 'string').map((item) => item.text).join('\n')
      : '';
  }
  if (typeof data?.output_text === 'string') return data.output_text;
  return (data?.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' && item.text)
    .map((item) => item.text).join('\n');
}

async function askAi(input) {
  const config = await getAiConfig();
  if (!config.apiKey) throw new Error('请先在助手面板的 AI 配置中填写 API Key。');
  const requestBody = config.apiType === 'chat-completions'
    ? {
      model: config.model,
      messages: [
        { role: 'system', content: config.prompt },
        { role: 'user', content: input }
      ]
    }
    : { model: config.model, instructions: config.prompt, input };
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(requestBody)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `模型请求失败（${response.status}）`);
  const text = responseText(data, config.apiType);
  if (!text) throw new Error('模型没有返回可读答案。');
  return { text, autoApplyAnswers: config.autoApplyAnswers === true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message.type === 'get-ai-config') {
    operation = getAiConfig().then((config) => {
      if (!sender.url?.startsWith(chrome.runtime.getURL(''))) config = { ...config, apiKey: '' };
      return { config };
    });
  }
  else if (message.type === 'save-ai-config') operation = saveAiConfig(message.config).then((config) => ({ config }));
  else if (message.type === 'open-ai-settings') {
    operation = chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/settings.html') })
      .then(() => ({ opened: true }));
  }
  else if (message.type === 'get-question-bank') operation = getQuestionBank(sender);
  else if (message.type === 'ask-ai') operation = askAi(message.input);
  else return false;

  operation.then(sendResponse).catch((error) => sendResponse({ error: error.message || '操作失败。' }));
  return true;
});
