function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Popup 页面缺少或类型错误的元素：${id}`);
  return element;
}

const detectButton = requiredElement('detect-button', HTMLButtonElement);
const openAssistantButton = requiredElement('open-assistant-button', HTMLButtonElement);
const dot = requiredElement('status-dot', HTMLElement);
const label = requiredElement('status-label', HTMLElement);
const detail = requiredElement('status-detail', HTMLElement);
const errorBox = requiredElement('error', HTMLElement);
const updateLabel = requiredElement('update-label', HTMLElement);
const updateDetail = requiredElement('update-detail', HTMLElement);
const updateButton = requiredElement('update-check-button', HTMLButtonElement);
const updateLink = requiredElement('update-link', HTMLAnchorElement);

function setStatus(kind: string, title: string, description: string): void {
  dot.className = `status-dot ${kind}`;
  label.textContent = title;
  detail.textContent = description;
}

function showError(message: string): void {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function sendTabMessage(tabId: number, message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function checkForUpdates(force = false): void {
  updateButton.disabled = true;
  updateLabel.textContent = '正在检查更新';
  updateDetail.textContent = '正在连接 GitHub 获取最新版本信息。';
  updateLink.hidden = true;

  chrome.runtime.sendMessage({ type: 'check-for-updates', force }, (response: unknown) => {
    updateButton.disabled = false;
    const reply = isRecord(response) ? response : null;
    if (chrome.runtime.lastError || reply?.error || !reply?.update || !isRecord(reply.update)) {
      updateLabel.textContent = '无法检查更新';
      updateDetail.textContent = chrome.runtime.lastError?.message || String(reply?.error || 'GitHub 未返回版本信息。');
      return;
    }

    const update = reply.update;
    if (typeof update.currentVersion !== 'string'
      || typeof update.latestVersion !== 'string'
      || typeof update.updateAvailable !== 'boolean'
      || typeof update.releaseUrl !== 'string') {
      updateLabel.textContent = '无法检查更新';
      updateDetail.textContent = 'GitHub 返回的版本信息格式无效。';
      return;
    }
    const { currentVersion, latestVersion, updateAvailable, releaseUrl } = update;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    chrome.tabs.sendMessage(tab.id, { type: 'inspect' }, (response: unknown) => {
      const reply = isRecord(response) ? response : null;
      if (chrome.runtime.lastError || !reply) {
        setStatus('', '页面尚未就绪', '请刷新 Pintia 页面后重试。');
        detectButton.disabled = false;
        return;
      }
      if (typeof reply.error === 'string') {
        setStatus('', '题目数据读取失败', '请确认当前账号已登录，并检查页面是否正常加载。');
        showError(reply.error);
        detectButton.disabled = false;
        return;
      }
      if (typeof reply.questionCount !== 'number' || reply.questionCount <= 0) {
        const reason = typeof reply.reason === 'string' ? reply.reason : 'no_questions';
        const messages: Record<string, [string, string]> = {
          auth: ['未检测到有效登录状态', '请在当前 pintia.cn 标签页登录，然后刷新作业页面并重新检测。'],
          no_target_api: ['未检测到作业题目数据', '请进入具体作业的题目列表页，并等待页面加载完成后重新检测。'],
          no_questions: ['当前页面未检测到题目', '请确认题目已加载；如问题仍存在，请刷新页面后重新检测。']
        };
        const [title, description] = messages[reason] || messages.no_questions;
        setStatus('', title, description);
        showError(description);
        detectButton.disabled = false;
        return;
      }

      chrome.storage.local.set({
        lastDetection: {
          source: tab.url,
          questionCount: reply.questionCount,
          questionTypes: Array.isArray(reply.questionTypes)
            ? reply.questionTypes.filter((type): type is string => typeof type === 'string')
            : [],
          detectedAt: new Date().toISOString()
        }
      });
      setStatus('ready', '题集检测完成', `共检测到 ${reply.questionCount} 道题目`);
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
    if (!isRecord(response)) throw new Error('页面尚未就绪，请刷新 Pintia 页面后重试。');
    if (response.error) throw new Error(String(response.error));
    if (typeof response.visible !== 'boolean') throw new Error('页面尚未就绪，请刷新 Pintia 页面后重试。');
    setStatus('ready', response.mode === 'automatic'
      ? '已启用全局自动显示'
      : '已关闭全局自动显示',
    response.mode === 'automatic'
      ? '助手会在 Pintia 页面自动显示。'
      : '当前页助手已隐藏；再次点击可重新启用并显示。');
    window.close();
  } catch (error) {
    showError(error instanceof Error ? error.message : '无法切换答案助手。请刷新 Pintia 页面后重试。');
    openAssistantButton.disabled = false;
  }
});
export {};
