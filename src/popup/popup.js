const detectButton = document.querySelector('#detect-button');
const button = document.querySelector('#download-button');
const openAssistantButton = document.querySelector('#open-assistant-button');
const dot = document.querySelector('#status-dot');
const label = document.querySelector('#status-label');
const detail = document.querySelector('#status-detail');
const errorBox = document.querySelector('#error');
const settingsView = document.querySelector('#settings-view');
const mainView = document.querySelector('.shell');
const settingsForm = document.querySelector('#settings-form');
const settingsError = document.querySelector('#settings-error');
const apiTypeInput = document.querySelector('#api-type-input');
const endpointInput = document.querySelector('#endpoint-input');
const modelInput = document.querySelector('#model-input');
const apiKeyInput = document.querySelector('#api-key-input');
const promptInput = document.querySelector('#prompt-input');

const defaultConfig = {
  apiType: 'chat-completions',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-mini',
  prompt: window.PintiaPrompt.systemPrompt,
  questionTypes: []
};
const legacyPrompt = '请根据题目信息直接给出最终答案，只输出 JSON，不要解释过程。';
let latestExport = null;

function setStatus(kind, title, description) {
  dot.className = `status-dot ${kind}`;
  label.textContent = title;
  detail.textContent = description;
}

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function sendTabMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        reject(new Error('没有找到当前标签页'));
        return;
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  });
}

function loadConfig() {
  chrome.storage.local.get({ aiConfig: defaultConfig, lastDetection: null }).then(({ aiConfig, lastDetection }) => {
    const config = aiConfig || {};
    const value = { ...defaultConfig, ...config, prompt: config.prompt === legacyPrompt ? defaultConfig.prompt : (config.prompt || defaultConfig.prompt) };
    apiTypeInput.value = config.apiType || (config.endpoint?.includes('/responses') ? 'responses' : defaultConfig.apiType);
    endpointInput.value = value.endpoint;
    modelInput.value = value.model;
    apiKeyInput.value = value.apiKey || '';
    promptInput.value = value.prompt;
    restoreDetection(lastDetection);
  }).catch(() => showSettingsError('无法读取本地配置，请重新打开扩展。'));
}

function restoreDetection(lastDetection) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!lastDetection || lastDetection.source !== tab?.url || !lastDetection.questionCount) return;
    button.disabled = false;
    openAssistantButton.disabled = false;
    setStatus('ready', '可以下载', `已恢复上次检测 · 已识别 ${lastDetection.questionCount} 道题目`);
  });
}

function showSettingsError(message) {
  settingsError.hidden = false;
  settingsError.textContent = message;
}

function setSettingsVisible(visible) {
  mainView.hidden = visible;
  settingsView.hidden = !visible;
  if (visible) loadConfig();
}

async function requestEndpointPermission(endpoint) {
  const origin = new URL(endpoint).origin;
  const origins = [`${origin}/*`];
  return chrome.permissions.request({ origins });
}

function readExport() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.tabs.sendMessage(tab.id, { type: 'export' }, (response) => {
        if (chrome.runtime.lastError || response?.error || !response?.questions?.length) {
          reject(new Error(response?.error || '当前页面没有可导出的题目'));
          return;
        }
        resolve(response);
      });
    });
  });
}

function showExtractionFailure(reason) {
  const messages = {
    auth: ['未检测到有效登录状态', '请在当前 pintia.cn 标签页登录账号，刷新作业页面后再检测。'],
    no_target_api: ['还没有打开作业题目页', '请进入具体作业的题目列表页，并等待页面加载完成后再检测。'],
    no_questions: ['当前页面没有可导出的题目', '请确认作业题目已加载；若仍失败，可刷新页面后重试。']
  };
  const [title, description] = messages[reason] || messages.no_questions;
  setStatus('', title, description);
  showError(description);
}

function safeFilename(name) {
  return (name || 'pintia-question-bank').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

detectButton.addEventListener('click', () => {
  detectButton.disabled = true;
  button.disabled = true;
  errorBox.hidden = true;
  setStatus('busy', '正在检测题库', '正在读取当前作业的题目接口');

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id || !tab.url?.startsWith('https://pintia.cn/')) {
      setStatus('', '不是 Pintia 页面', '请打开 pintia.cn 的作业题目页');
      detectButton.disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'inspect' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus('', '页面尚未准备好', '刷新 Pintia 页面后再试一次');
        detectButton.disabled = false;
        return;
      }
      if (response.error) {
        setStatus('', '接口读取失败', '请确认当前账号仍处于登录状态');
        showError(response.error);
        detectButton.disabled = false;
        return;
      }
      if (!response.questionCount) {
        showExtractionFailure(response.reason);
        detectButton.disabled = false;
        return;
      }
      latestExport = null;
      chrome.storage.local.set({ lastDetection: {
        source: tab.url,
        questionCount: response.questionCount,
        questionTypes: response.questionTypes,
        detectedAt: new Date().toISOString()
      } });
      setStatus('ready', '可以下载', `接口模式 · 已识别 ${response.questionCount} 道题目`);
      button.disabled = false;
      openAssistantButton.disabled = false;
      detectButton.disabled = false;
    });
  });
});

openAssistantButton.addEventListener('click', async () => {
  try {
    await sendTabMessage({ type: 'open-assistant' });
    setStatus('ready', '悬浮助手已打开', '可关闭弹窗，在页面助手中粘贴答案并回填');
    setTimeout(() => window.close(), 100);
  } catch (error) {
    showError(error.message);
  }
});
document.querySelector('#settings-button').addEventListener('click', () => setSettingsVisible(true));
document.querySelector('#back-button').addEventListener('click', () => setSettingsVisible(false));

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsError.hidden = true;
  const endpoint = endpointInput.value.trim();
  try {
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
    const allowed = await requestEndpointPermission(endpoint);
    if (!allowed) throw new Error('未获得连接模型服务的权限。');
    await chrome.storage.local.set({ aiConfig: {
      apiType: apiTypeInput.value,
      endpoint,
      model: modelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      prompt: promptInput.value.trim(),
      questionTypes: []
    } });
    setSettingsVisible(false);
    setStatus('ready', '配置已保存', 'API Key 仅保存在浏览器本地');
  } catch (error) {
    showSettingsError(error.message || '保存配置失败');
  }
});

loadConfig();

button.addEventListener('click', () => {
  button.disabled = true;
  errorBox.hidden = true;
  setStatus('busy', '正在整理题库', '马上生成本地 JSON 文件');

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { type: 'export' }, (response) => {
      if (chrome.runtime.lastError || response?.error || !response?.questions?.length) {
        setStatus('', '下载失败', '当前页面没有可导出的题目');
        showError(response?.error || '请确认你已经打开作业的题目列表，而不是课程首页。');
        button.disabled = false;
        return;
      }

      const payload = JSON.stringify(response, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      chrome.downloads.download({
        url,
        filename: `${safeFilename(tab.title || response.title || 'pintia-question-bank')}.json`,
        saveAs: true
      }, () => {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError) {
          setStatus('', '保存失败', chrome.runtime.lastError.message);
          button.disabled = false;
          return;
        }
        setStatus('ready', '下载完成', `已保存 ${response.questions.length} 道题目`);
        button.disabled = false;
      });
    });
  });
});
