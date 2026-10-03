const detectButton = document.querySelector('#detect-button');
const openAssistantButton = document.querySelector('#open-assistant-button');
const dot = document.querySelector('#status-dot');
const label = document.querySelector('#status-label');
const detail = document.querySelector('#status-detail');
const errorBox = document.querySelector('#error');

function setStatus(kind, title, description) {
  dot.className = `status-dot ${kind}`;
  label.textContent = title;
  detail.textContent = description;
}

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const isPintia = tab?.url?.startsWith('https://pintia.cn/');
  openAssistantButton.disabled = !isPintia;
  chrome.storage.local.get('lastDetection').then(({ lastDetection }) => {
    if (!lastDetection || lastDetection.source !== tab?.url || !lastDetection.questionCount) return;
    setStatus('ready', '题库已检测', `上次识别 ${lastDetection.questionCount} 道题目`);
  });
});

detectButton.addEventListener('click', () => {
  detectButton.disabled = true;
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
        const messages = {
          auth: ['未检测到有效登录状态', '请在当前 pintia.cn 标签页登录账号，刷新作业页面后再检测。'],
          no_target_api: ['还没有打开作业题目页', '请进入具体作业的题目列表页，并等待页面加载完成后再检测。'],
          no_questions: ['当前页面没有可导出的题目', '请确认作业题目已加载；若仍失败，可刷新页面后重试。']
        };
        const [title, description] = messages[response.reason] || messages.no_questions;
        setStatus('', title, description);
        showError(description);
        detectButton.disabled = false;
        return;
      }

      chrome.storage.local.set({
        lastDetection: {
          source: tab.url,
          questionCount: response.questionCount,
          questionTypes: response.questionTypes,
          detectedAt: new Date().toISOString()
        }
      });
      setStatus('ready', '题库检测完成', `已识别 ${response.questionCount} 道题目`);
      openAssistantButton.disabled = false;
      detectButton.disabled = false;
    });
  });
});

openAssistantButton.addEventListener('click', async () => {
  openAssistantButton.disabled = true;
  errorBox.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有找到当前标签页');
    await sendTabMessage(tab.id, { type: 'open-assistant' });
    setStatus('ready', '助手面板已打开', '配置 AI、导出题库或在面板中分析答案');
    setTimeout(() => window.close(), 100);
  } catch (error) {
    showError(error.message || '无法打开助手面板，请刷新 Pintia 页面后重试。');
    openAssistantButton.disabled = false;
  }
});
