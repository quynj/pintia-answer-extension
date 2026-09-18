const detectButton = document.querySelector('#detect-button');
const button = document.querySelector('#download-button');
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
      setStatus('ready', '可以下载', `接口模式 · 已识别 ${response.questionCount} 道题目`);
      button.disabled = false;
      detectButton.disabled = false;
    });
  });
});

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
