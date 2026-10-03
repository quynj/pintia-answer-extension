(() => {
  const promptApi = window.PintiaPrompt;
  const state = {
    questions: [],
    problemSetId: null
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
        <div><button data-action="collapse" title="收起">−</button><button data-action="close" title="关闭">×</button></div>
      </div>
      <div class="pintia-assistant-body">
        <p class="pintia-assistant-status" data-status>等待选择题目</p>
        <div class="pintia-assistant-types" data-types><span>包含题型</span><em>正在读取题库...</em></div>
        <textarea data-answer placeholder="粘贴严格格式的答案 JSON，或使用 API 分析"></textarea>
        <div class="pintia-assistant-actions">
          <button data-action="prompt">复制 Prompt</button>
          <button data-action="api">API 辅助分析</button>
          <button data-action="apply">解析并回填</button>
        </div>
        <p class="pintia-assistant-log" data-log></p>
      </div>`;
    document.body.appendChild(panel);
    bindPanel(panel);
    enableDragging(panel);
    loadQuestions(panel);
    return panel;
  }

  function setStatus(panel, message) {
    panel.querySelector('[data-status]').textContent = message;
  }

  function setLog(panel, message) {
    panel.querySelector('[data-log]').textContent = message;
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
    const prompt = promptApi.build(document.title, questions, state.problemSetId);
    await navigator.clipboard.writeText(prompt);
    setStatus(panel, 'Prompt 已复制');
    setLog(panel, 'Prompt 已复制，可粘贴到网页 AI。答案解析与页面回填功能开发中。');
  }

  async function requestApiAnswer(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    setStatus(panel, '正在请求 API 辅助分析');
    const input = promptApi.build(document.title, questions, state.problemSetId);
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ask-ai', input }, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });
    if (response?.error) throw new Error(response.error);
    if (typeof response?.text !== 'string' || !response.text.trim()) throw new Error('API 未返回答案文本。');
    panel.querySelector('[data-answer]').value = response.text;
    setStatus(panel, 'API 答案已放入文本框');
    setLog(panel, '请检查答案 JSON 后点击“解析并回填”。');
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
      panel.style.left = `${Math.max(0, event.clientX - offsetX)}px`;
      panel.style.top = `${Math.max(0, event.clientY - offsetY)}px`;
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
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'api') await requestApiAnswer(panel);
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
