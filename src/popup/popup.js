const detectButton = document.querySelector('#detect-button');
const button = document.querySelector('#download-button');
const aiButton = document.querySelector('#ai-button');
const dot = document.querySelector('#status-dot');
const label = document.querySelector('#status-label');
const detail = document.querySelector('#status-detail');
const errorBox = document.querySelector('#error');
const aiResult = document.querySelector('#ai-result');
const aiAnswer = document.querySelector('#ai-answer');
const saveAnswerButton = document.querySelector('#save-answer');
const settingsView = document.querySelector('#settings-view');
const mainView = document.querySelector('.shell');
const settingsForm = document.querySelector('#settings-form');
const settingsError = document.querySelector('#settings-error');
const apiTypeInput = document.querySelector('#api-type-input');
const endpointInput = document.querySelector('#endpoint-input');
const modelInput = document.querySelector('#model-input');
const apiKeyInput = document.querySelector('#api-key-input');
const promptInput = document.querySelector('#prompt-input');
const typeGrid = document.querySelector('#type-grid');
let availableQuestionTypes = [];
let savedQuestionTypes = null;

const typeLabels = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  programming: '编程题',
  short_answer: '简答题',
  unknown: '其他题型'
};

const defaultConfig = {
  apiType: 'chat-completions',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4.1-mini',
  prompt: '请逐题只输出最终答案，不要解析过程。选择题只输出选项，判断题只输出判断结果，填空题只输出填空内容，编程题只输出可提交的代码。',
  questionTypes: []
};
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

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function selectedQuestionTypes() {
  return [...typeGrid.querySelectorAll('input[name="question-type"]:checked')].map((input) => input.value);
}

function renderQuestionTypes(types = [], selectedTypes = null) {
  availableQuestionTypes = [...new Set(types)];
  if (!availableQuestionTypes.length) {
    typeGrid.innerHTML = '<p class="type-empty">请先检测题库</p>';
    return;
  }
  const selected = selectedTypes?.length ? new Set(selectedTypes) : null;
  typeGrid.innerHTML = availableQuestionTypes.map((type) => `
    <label><input type="checkbox" name="question-type" value="${type}" ${selected ? (selected.has(type) ? 'checked' : '') : 'checked'} /> ${typeLabels[type] || type}</label>
  `).join('');
}

function loadConfig() {
  chrome.storage.local.get({ aiConfig: defaultConfig, lastDetection: null }).then(({ aiConfig, lastDetection }) => {
    const config = aiConfig || {};
    const value = { ...defaultConfig, ...config };
    apiTypeInput.value = config.apiType || (config.endpoint?.includes('/responses') ? 'responses' : defaultConfig.apiType);
    endpointInput.value = value.endpoint;
    modelInput.value = value.model;
    apiKeyInput.value = value.apiKey || '';
    promptInput.value = value.prompt;
    savedQuestionTypes = value.questionTypes;
    if (availableQuestionTypes.length) renderQuestionTypes(availableQuestionTypes, savedQuestionTypes);
    restoreDetection(lastDetection);
  }).catch(() => showSettingsError('无法读取本地配置，请重新打开扩展。'));
}

function restoreDetection(lastDetection) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!lastDetection || lastDetection.source !== tab?.url || !lastDetection.questionCount) return;
    renderQuestionTypes(lastDetection.questionTypes, savedQuestionTypes);
    button.disabled = false;
    aiButton.disabled = false;
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

function questionInput(result, selectedTypes) {
  const questions = result.questions.filter((question) => selectedTypes.includes(question.type));
  return { questions, text: [
    `题库：${result.title}`,
    `请根据下面接口返回的完整题目数据，回答 ${questions.length} 道题。不要遗漏题目选项、题目配置或其他字段：`,
    ...questions.map((question) => JSON.stringify({
      number: question.number,
      type: question.type,
      data: question.apiData || question
    }))
  ].join('\n') };
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
      renderQuestionTypes(response.questionTypes, savedQuestionTypes);
      chrome.storage.local.set({ lastDetection: {
        source: tab.url,
        questionCount: response.questionCount,
        questionTypes: response.questionTypes,
        detectedAt: new Date().toISOString()
      } });
      setStatus('ready', '可以下载', `接口模式 · 已识别 ${response.questionCount} 道题目`);
      button.disabled = false;
      aiButton.disabled = false;
      detectButton.disabled = false;
    });
  });
});

aiButton.addEventListener('click', async () => {
  aiButton.disabled = true;
  errorBox.hidden = true;
  aiResult.hidden = true;
  setStatus('busy', '正在生成辅助分析', '正在整理题目并等待模型响应');
  try {
    latestExport = latestExport || await readExport();
    const selectedTypes = selectedQuestionTypes();
    const input = questionInput(latestExport, selectedTypes);
    if (!input.questions.length) throw new Error('当前选择的题型没有题目，请在 AI 配置中调整。');
    const response = await sendMessage({ type: 'ask-ai', input: input.text });
    if (response?.error) throw new Error(response.error);
    aiAnswer.textContent = response.text;
    aiResult.hidden = false;
    setStatus('ready', '回答完成', `已回答 ${input.questions.length} 道题目`);
  } catch (error) {
    setStatus('', 'AI 请求失败', '请检查配置、网络和模型服务状态');
    showError(error.message);
  } finally {
    aiButton.disabled = false;
  }
});

document.querySelector('#close-result').addEventListener('click', () => { aiResult.hidden = true; });
saveAnswerButton.addEventListener('click', () => {
  const payload = aiAnswer.textContent || '';
  if (!payload) return;
  const url = URL.createObjectURL(new Blob([payload], { type: 'text/plain;charset=utf-8' }));
  const date = new Date().toISOString().slice(0, 10);
  chrome.downloads.download({
    url,
    filename: `${safeFilename(latestExport?.title || 'pintia-ai-answer')}-${date}.txt`,
    saveAs: true
  }, () => {
    URL.revokeObjectURL(url);
    if (chrome.runtime.lastError) showError(`答案保存失败：${chrome.runtime.lastError.message}`);
  });
});
document.querySelector('#settings-button').addEventListener('click', () => setSettingsVisible(true));
document.querySelector('#back-button').addEventListener('click', () => setSettingsVisible(false));

typeGrid.addEventListener('change', () => {
  savedQuestionTypes = selectedQuestionTypes();
  chrome.storage.local.get({ aiConfig: defaultConfig }).then(({ aiConfig }) => chrome.storage.local.set({
    aiConfig: { ...defaultConfig, ...aiConfig, questionTypes: savedQuestionTypes }
  }));
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsError.hidden = true;
  const endpoint = endpointInput.value.trim();
  try {
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
    const allowed = await requestEndpointPermission(endpoint);
    if (!allowed) throw new Error('未获得连接模型服务的权限。');
    const questionTypes = selectedQuestionTypes();
    if (!questionTypes.length) throw new Error('至少选择一种题型。');
    await chrome.storage.local.set({ aiConfig: {
      apiType: apiTypeInput.value,
      endpoint,
      model: modelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      prompt: promptInput.value.trim(),
      questionTypes
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
      const date = new Date().toISOString().slice(0, 10);
      chrome.downloads.download({
        url,
        filename: `${safeFilename(response.title)}-${date}.json`,
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
