(() => {
  const parser = window.PintiaAnswer;
  const autofill = window.PintiaAutofill;
  const promptApi = window.PintiaPrompt;
  const state = {
    answers: [],
    index: 0,
    paused: false,
    stopped: false,
    running: false,
    questions: []
  };

  const typeLabels = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    programming: '编程题',
    short_answer: '简答题',
    unknown: '其他题型'
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
        <p class="pintia-assistant-status" data-status>等待粘贴 AI JSON 答案</p>
        <div class="pintia-assistant-types" data-types><span>包含题型</span><em>正在读取题库...</em></div>
        <textarea data-answer placeholder='粘贴网页 AI 返回的 JSON，例如 {"answers":[...]}'></textarea>
        <div class="pintia-assistant-actions">
          <button data-action="prompt">复制 Prompt</button>
          <button data-action="api">API 辅助分析</button>
          <button data-action="parse">解析答案</button>
        </div>
        <div class="pintia-assistant-actions">
          <button data-action="start">开始回填</button>
          <button data-action="continue" disabled>继续</button>
          <button data-action="pause" disabled>暂停</button>
          <button data-action="stop" disabled>停止</button>
        </div>
        <button class="pintia-assistant-retry" data-action="retry" disabled>重试当前题</button>
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

  function setRunningControls(panel, running) {
    panel.querySelector('[data-action="start"]').disabled = running;
    panel.querySelector('[data-action="continue"]').disabled = running || !state.paused || state.index >= state.answers.length;
    panel.querySelector('[data-action="pause"]').disabled = !running;
    panel.querySelector('[data-action="stop"]').disabled = !running;
    panel.querySelector('[data-action="retry"]').disabled = running || state.index >= state.answers.length;
  }

  async function loadQuestions(panel) {
    try {
      const result = await window.PintiaAssistantExtract();
      state.questions = result.questions;
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

  function parse(panel) {
    const answers = parser.parse(panel.querySelector('[data-answer]').value);
    if (!answers.length) throw new Error('没有解析出答案，请确认模型只返回了标准 JSON。');
    state.answers = answers;
    state.index = 0;
    state.paused = false;
    state.stopped = false;
    setStatus(panel, `已解析 ${answers.length} 道答案`);
    setLog(panel, '点击“开始回填”后才会写入页面。');
    setRunningControls(panel, false);
  }

  async function fillOne(panel, index) {
    const answer = state.answers[index];
    if (!answer) return { ok: false, reason: '没有当前答案' };
    setStatus(panel, `正在回填第 ${answer.questionNumber || '?'} 题（${index + 1}/${state.answers.length}）`);
    const result = await autofill.fill(answer);
    if (result.ok) {
      state.index += 1;
      setLog(panel, `第 ${answer.questionNumber || '?'} 题已写入并通过校验。`);
    } else {
      state.paused = true;
      setLog(panel, result.reason || '回填失败，已暂停。');
    }
    return result;
  }

  async function run(panel) {
    if (!state.answers.length) parse(panel);
    state.running = true;
    state.paused = false;
    state.stopped = false;
    setRunningControls(panel, true);
    while (state.index < state.answers.length && !state.paused && !state.stopped) {
      const result = await fillOne(panel, state.index);
      if (!result.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    state.running = false;
    setRunningControls(panel, false);
    if (state.stopped) setStatus(panel, '已停止');
    else if (state.paused) setStatus(panel, '已暂停，请检查页面后继续或重试');
    else if (state.index >= state.answers.length) setStatus(panel, '全部回填完成，请自行核对，不会自动提交');
  }

  async function copyPrompt(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    const prompt = promptApi.build(document.title, questions);
    await navigator.clipboard.writeText(prompt);
    setStatus(panel, 'Prompt 已复制');
    setLog(panel, '已打开网页 AI 后粘贴 Prompt，拿到 JSON 后回到这里粘贴。');
  }

  async function requestApiAnswer(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    setStatus(panel, '正在请求 API 辅助分析');
    const input = [
      `题库：${document.title}`,
      '请回答以下题目并严格只输出 JSON：',
      ...questions.map((question) => JSON.stringify({ number: question.number, type: question.type, data: question.apiData || question }))
    ].join('\n');
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ask-ai', input }, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });
    if (response?.error) throw new Error(response.error);
    panel.querySelector('[data-answer]').value = response.text;
    setStatus(panel, 'API 答案已放入文本框');
    setLog(panel, '请点击“解析答案”，确认后再开始回填。');
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
        if (action === 'parse') parse(panel);
        if (action === 'start') await run(panel);
        if (action === 'pause') { state.paused = true; setStatus(panel, '正在暂停'); }
        if (action === 'continue') await run(panel);
        if (action === 'stop') { state.stopped = true; state.paused = true; }
        if (action === 'retry') {
          state.paused = false;
          state.stopped = false;
          await run(panel);
        }
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'api') await requestApiAnswer(panel);
      } catch (error) {
        state.running = false;
        setRunningControls(panel, false);
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
    return { title: document.title, questions: result.questions };
  };
})();
