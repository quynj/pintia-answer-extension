const detectButton = document.querySelector('#detect-button');
const openAssistantButton = document.querySelector('#open-assistant-button');
const dot = document.querySelector('#status-dot');
const label = document.querySelector('#status-label');
const detail = document.querySelector('#status-detail');
const errorBox = document.querySelector('#error');
const updateLabel = document.querySelector('#update-label');
const updateDetail = document.querySelector('#update-detail');
const updateButton = document.querySelector('#update-check-button');
const updateLink = document.querySelector('#update-link');

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

function checkForUpdates(force = false) {
  updateButton.disabled = true;
  updateLabel.textContent = '正在检查更新';
  updateDetail.textContent = '正在连接 GitHub 获取最新版本信息。';
  updateLink.hidden = true;

  chrome.runtime.sendMessage({ type: 'check-for-updates', force }, (response) => {
    updateButton.disabled = false;
    if (chrome.runtime.lastError || response?.error || !response?.update) {
      updateLabel.textContent = '无法检查更新';
      updateDetail.textContent = chrome.runtime.lastError?.message || response?.error || 'GitHub 未返回版本信息。';
      return;
    }

    const { currentVersion, latestVersion, updateAvailable, releaseUrl } = response.update;
    if (updateAvailable) {
      updateLabel.textContent = `发现新版本 v${latestVersion}`;
      updateDetail.textContent = `当前版本 v${currentVersion}。下载新版后，请在扩展管理页加载或重新加载解压后的目录。`;
      updateLink.href = releaseUrl;
      updateLink.hidden = false;
    } else {
      updateLabel.textContent = '已是最新版本';
      updateDetail.textContent = `当前版本 v${currentVersion} · GitHub 最新版本 v${latestVersion}`;
    }
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const isPintia = tab?.url?.startsWith('https://pintia.cn/');
  openAssistantButton.disabled = !isPintia;
  chrome.storage.local.get('lastDetection').then(({ lastDetection }) => {
    if (!lastDetection || lastDetection.source !== tab?.url || !lastDetection.questionCount) return;
    setStatus('ready', '题库已检测', `最近一次检测到 ${lastDetection.questionCount} 道题目`);
  });
});

updateButton.addEventListener('click', () => checkForUpdates(true));
checkForUpdates();

detectButton.addEventListener('click', () => {
  detectButton.disabled = true;
  errorBox.hidden = true;
  setStatus('busy', '正在检测题集', '正在读取当前作业的题目数据');

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id || !tab.url?.startsWith('https://pintia.cn/')) {
      setStatus('', '当前页面不是 Pintia', '请在 pintia.cn 的作业题目页面执行此操作。');
      detectButton.disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'inspect' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus('', '页面尚未就绪', '请刷新 Pintia 页面后重试。');
        detectButton.disabled = false;
        return;
      }
      if (response.error) {
        setStatus('', '题目数据读取失败', '请确认当前账号已登录，并检查页面是否正常加载。');
        showError(response.error);
        detectButton.disabled = false;
        return;
      }
      if (!response.questionCount) {
        const messages = {
          auth: ['未检测到有效登录状态', '请在当前 pintia.cn 标签页登录，然后刷新作业页面并重新检测。'],
          no_target_api: ['未检测到作业题目数据', '请进入具体作业的题目列表页，并等待页面加载完成后重新检测。'],
          no_questions: ['当前页面未检测到题目', '请确认题目已加载；如问题仍存在，请刷新页面后重新检测。']
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
      setStatus('ready', '题集检测完成', `共检测到 ${response.questionCount} 道题目`);
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
    if (!tab?.id) throw new Error('无法获取当前浏览器标签页。');
    const response = await sendTabMessage(tab.id, { type: 'toggle-assistant' });
    if (response?.error) throw new Error(response.error);
    if (typeof response?.visible !== 'boolean') throw new Error('页面尚未就绪，请刷新 Pintia 页面后重试。');
    setStatus('ready', response.visible ? '答案助手已打开' : '答案助手已关闭',
      response.visible ? '可配置 AI 服务、导出题库或生成答案。' : '点击下方按钮可重新打开助手面板。');
    window.close();
  } catch (error) {
    showError(error.message || '无法切换答案助手。请刷新 Pintia 页面后重试。');
    openAssistantButton.disabled = false;
  }
});
