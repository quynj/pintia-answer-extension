(() => {
  const promptApi = window.PintiaPrompt;
  const state = {
    questions: [],
    problemSetId: null,
    aiConfig: null
  };

  const typeLabels = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    programming: '编程题',
    short_answer: '简答题',
    answer: '其他题型'
  };

  function createPanel() {
    if (document.querySelector('#pintia-assistant-panel')) return document.querySelector('#pintia-assistant-panel');
    const panel = document.createElement('aside');
    panel.id = 'pintia-assistant-panel';
    panel.innerHTML = `
      <div class="pintia-assistant-head">
        <strong>Pintia 助手</strong>
        <div><button data-action="settings" title="AI 配置">AI 配置</button><button data-action="collapse" title="收起">−</button><button data-action="close" title="关闭">×</button></div>
      </div>
      <div class="pintia-assistant-body" data-view="assistant">
        <p class="pintia-assistant-status" data-status>等待选择题目</p>
        <div class="pintia-assistant-types" data-types><span>包含题型</span><em>正在读取题库...</em></div>
        <textarea data-answer placeholder="粘贴严格格式的答案 JSON，或使用 API 分析"></textarea>
        <div class="pintia-assistant-actions">
          <button data-action="prompt">复制 Prompt</button>
          <button data-action="api">API 辅助分析</button>
          <button data-action="export">导出题库 JSON</button>
          <button data-action="apply">解析并回填</button>
        </div>
        <p class="pintia-assistant-log" data-log></p>
      </div>`;
    document.body.appendChild(panel);
    bindPanel(panel);
    enableDragging(panel);
    loadQuestions(panel);
    loadConfig(panel);
    return panel;
  }

  function setStatus(panel, message) {
    panel.querySelector('[data-status]').textContent = message;
  }

  function setLog(panel, message) {
    panel.querySelector('[data-log]').textContent = message;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  async function loadConfig(panel) {
    try {
      const { config } = await sendRuntimeMessage({ type: 'get-ai-config' });
      state.aiConfig = config;
    } catch (error) {
      setLog(panel, error.message || '无法读取 AI 配置');
    }
  }

  async function openSettings(panel) {
    await sendRuntimeMessage({ type: 'open-ai-settings' });
    state.aiConfig = null;
    setStatus(panel, '已打开 AI 配置页');
    setLog(panel, '请在新标签页中保存模型服务配置。');
  }

  async function loadQuestions(panel) {
    try {
      const result = await window.PintiaAssistantExtract();
      state.questions = result.questions;
      state.problemSetId = result.problemSetId;
      const types = [...new Set(state.questions.map((question) => question.type))];
      panel.querySelector('[data-types]').innerHTML = `<span>包含题型</span>${types.map((type) => `<label><input type="checkbox" value="${type}" checked />${typeLabels[type] || type}</label>`).join('')}`;
    } catch (error) {
      panel.querySelector('[data-types]').innerHTML = '<span>包含题型</span><em>题库读取失败</em>';
      setLog(panel, error.message || '题库读取失败');
    }
  }

  function selectedQuestions(panel) {
    const selected = new Set([...panel.querySelectorAll('[data-types] input:checked')].map((input) => input.value));
    return state.questions.filter((question) => selected.has(question.type));
  }

  async function copyPrompt(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    if (!state.aiConfig) await loadConfig(panel);
    const prompt = promptApi.build(document.title, questions, state.problemSetId, state.aiConfig?.prompt);
    await navigator.clipboard.writeText(prompt);
    setStatus(panel, 'Prompt 已复制');
    setLog(panel, 'Prompt 已复制，可粘贴到网页 AI。');
  }

  async function requestApiAnswer(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    setStatus(panel, '正在请求 API 辅助分析');
    const input = promptApi.buildInput(document.title, questions, state.problemSetId);
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ask-ai', input }, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });
    if (response?.error) throw new Error(response.error);
    if (typeof response?.text !== 'string' || !response.text.trim()) throw new Error('API 未返回答案文本。');
    panel.querySelector('[data-answer]').value = response.text;
    if (response.autoApplyAnswers) {
      setStatus(panel, 'API 已返回答案，正在自动回填并保存');
      setLog(panel, '自动模式已开启，正在校验答案并按勾选题型回填。');
      await applyAnswers(panel);
      return;
    }
    setStatus(panel, 'API 答案已放入文本框');
    setLog(panel, '请检查答案 JSON 后点击“解析并回填”。');
  }

  async function exportQuestionBank(panel) {
    setStatus(panel, '正在导出题库');
    const { result } = await sendRuntimeMessage({ type: 'get-question-bank' });
    const filename = (result.title || document.title || 'pintia-question-bank')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80) || 'pintia-question-bank';
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(panel, '题库导出已开始');
    setLog(panel, `正在保存包含 ${result.questions.length} 道题目的 JSON 文件。`);
  }

  async function applyAnswers(panel) {
    const button = panel.querySelector('[data-action="apply"]');
    button.disabled = true;
    try {
      const answers = window.PintiaAnswerRunner.parse(
        panel.querySelector('[data-answer]').value,
        state.problemSetId
      );
      const selectedTypes = [...panel.querySelectorAll('[data-types] input:checked')]
        .map((input) => input.value);
      if (!selectedTypes.length) throw new Error('请至少选择一种题型。');
      setStatus(panel, '正在回填并验证答案');
      const report = await window.PintiaAnswerRunner.run(answers, selectedTypes);
      const { total, success, failed, skipped } = report.summary;
      setStatus(panel, report.success ? '答案回填并保存完成' : '回填完成，存在未完成题目');
      const failures = report.results
        .filter((result) => !result.success)
        .map((result) => `第 ${result.questionNumber ?? '?'} 题：${result.reason}`);
      setLog(panel, `共 ${total} 题，成功 ${success}，失败 ${failed}，跳过 ${skipped}${failures.length ? `。${failures.join('；')}` : ''}`);
    } finally {
      button.disabled = false;
    }
  }

  function enableDragging(panel) {
    const head = panel.querySelector('.pintia-assistant-head');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panel.classList.add('is-dragging');
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, head.offsetHeight));
      panel.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
      panel.style.right = 'auto';
    });
    head.addEventListener('pointerup', () => {
      dragging = false;
      panel.classList.remove('is-dragging');
    });
  }

  function bindPanel(panel) {
    panel.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      try {
        if (action === 'collapse') panel.classList.toggle('is-collapsed');
        if (action === 'close') panel.remove();
        if (action === 'settings') await openSettings(panel);
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'api') await requestApiAnswer(panel);
        if (action === 'export') await exportQuestionBank(panel);
        if (action === 'apply') await applyAnswers(panel);
      } catch (error) {
        setStatus(panel, '操作失败');
        setLog(panel, error.message || '助手操作失败');
      }
    });
  }

  window.PintiaAssistant = {
    open: createPanel
  };

  window.PintiaAssistantExtract = async () => {
    const result = await window.PintiaExtractor.extractFromApi();
    return { title: document.title, problemSetId: result.problemSetId, questions: result.questions };
  };
})();
