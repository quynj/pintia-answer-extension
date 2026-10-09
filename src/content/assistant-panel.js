(() => {
  const promptApi = window.PintiaPrompt;
  const state = {
    questions: [],
    problemSetId: null,
    aiConfig: null,
    latestReport: null,
    activeAiRequestId: null,
    aiPhase: null,
    aiPhaseStartedAt: 0,
    aiElapsedTimer: null,
    configReady: Promise.resolve(),
    collapsed: true,
    panelStateReady: chrome.storage.local.get('assistantCollapsed').then(({ assistantCollapsed }) => {
      if (typeof assistantCollapsed === 'boolean') state.collapsed = assistantCollapsed;
    })
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

  function createPanel(extractedQuestions) {
    const existingPanel = document.querySelector('#pintia-assistant-panel');
    if (existingPanel) return existingPanel;
    const panel = document.createElement('aside');
    panel.id = 'pintia-assistant-panel';
    panel.classList.toggle('is-collapsed', state.collapsed);
    panel.innerHTML = `
      <div class="pintia-assistant-head">
        <strong>Pintia 学习助手</strong>
        <div><button data-action="settings" title="AI 配置">AI 配置</button><button data-action="collapse" title="收起" aria-label="收起答案助手">−</button><button data-action="close" title="关闭">×</button></div>
      </div>
      <div class="pintia-assistant-body" data-view="assistant">
        <p class="pintia-assistant-status" data-status>请选择要处理的题型</p>
        <div class="pintia-assistant-types" data-types><span>处理题型</span><em>正在读取题库…</em></div>
        <div class="pintia-assistant-options">
          <label><input type="checkbox" data-auto-save />自动回填并保存</label>
          <label><input type="checkbox" data-diagnostic-logging />记录 AI 诊断日志</label>
          <small>范围跟随上方勾选题型；全选时覆盖整套题中的可回填题型。编程题和简答题暂不支持页面回填。关闭后可手动回填，但不会保存。</small>
        </div>
        <details class="pintia-assistant-report" data-report hidden>
          <summary>回填明细</summary>
          <ol data-report-list></ol>
        </details>
        <label class="pintia-assistant-answer-label" for="pintia-assistant-answer">答案内容（JSON）</label>
        <p class="pintia-assistant-answer-hint">AI 生成结果（含复核后的最终答案）会显示在此处。关闭自动回填时，请核对答案后手动执行回填。</p>
        <textarea id="pintia-assistant-answer" data-answer placeholder="粘贴答案 JSON，或通过 AI 生成答案"></textarea>
        <div class="pintia-assistant-actions">
          <button data-action="prompt">复制提示词</button>
          <button data-action="api">AI 生成答案</button>
          <button data-action="export">导出题库</button>
          <button data-action="apply">校验并回填</button>
        </div>
        <p class="pintia-assistant-log" data-log></p>
        <details class="pintia-assistant-diagnostics" data-diagnostics hidden>
          <summary>本次 AI 诊断日志</summary>
          <ol data-diagnostic-list></ol>
        </details>
      </div>`;
    const collapseButton = panel.querySelector('[data-action="collapse"]');
    collapseButton.title = state.collapsed ? '展开' : '收起';
    collapseButton.setAttribute('aria-label', state.collapsed ? '展开答案助手' : '收起答案助手');
    document.body.appendChild(panel);
    bindPanel(panel);
    enableDragging(panel);
    if (state.latestReport) {
      updateReport(panel, state.latestReport.report);
      setLog(panel, state.latestReport.message);
    }
    loadQuestions(panel, extractedQuestions);
    state.configReady = loadConfig(panel);
    return panel;
  }

  function setStatus(panel, message) {
    panel.querySelector('[data-status]').textContent = message;
  }

  function setLog(panel, message) {
    panel.querySelector('[data-log]').textContent = message;
  }

  function diagnosticLog(panel, message) {
    if (!panel.querySelector('[data-diagnostic-logging]').checked) return;
    const list = panel.querySelector('[data-diagnostic-list]');
    const item = document.createElement('li');
    item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
    list.appendChild(item);
    panel.querySelector('[data-diagnostics]').hidden = false;
  }

  function updateAiElapsed(panel) {
    if (!state.aiPhase || !state.aiPhaseStartedAt) return;
    const seconds = Math.floor((Date.now() - state.aiPhaseStartedAt) / 1000);
    const phaseLabel = state.aiPhase === '复核' ? '初稿已返回，正在请求复核' : '正在请求初稿';
    setStatus(panel, `${phaseLabel}（已等待 ${seconds} 秒）`);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'ai-progress' || message.requestId !== state.activeAiRequestId) return;
    const panel = document.querySelector('#pintia-assistant-panel');
    if (!panel) return;
    if (message.phase === 'draft-started' || message.phase === 'review-started') {
      state.aiPhase = message.phase === 'draft-started' ? '初稿' : '复核';
      state.aiPhaseStartedAt = Date.now();
      if (!state.aiElapsedTimer) state.aiElapsedTimer = window.setInterval(() => updateAiElapsed(panel), 1000);
      updateAiElapsed(panel);
      diagnosticLog(panel, `${state.aiPhase}请求开始`);
      return;
    }

    const stage = message.phase.startsWith('draft-') ? '初稿' : '复核';
    const duration = `${((message.durationMs || 0) / 1000).toFixed(1)} 秒`;
    if (message.phase.endsWith('-completed')) {
      diagnosticLog(panel, `${stage}请求完成，耗时 ${duration}`);
    } else if (message.phase.endsWith('-failed')) {
      const reasons = {
        timeout: '超时',
        'invalid-output': '结果校验失败',
        'request-failed': '请求失败'
      };
      diagnosticLog(panel, `${stage}${reasons[message.reason] || '未完成'}，耗时 ${duration}`);
    }
  });

  function formatAnswer(answer) {
    if (answer === null || answer === undefined) return '未作答';
    if (Array.isArray(answer)) return answer.length ? answer.join('、') : '未选择';
    if (typeof answer === 'boolean') return answer ? '是' : '否';
    return String(answer);
  }

  function hasAnswerChanges(result) {
    return result.action === 'updated'
      || result.optionActions?.some(({ action }) => action === 'checked' || action === 'unchecked')
      || result.blankActions?.some(({ action }) => action === 'updated');
  }

  function updateReport(panel, report) {
    const container = panel.querySelector('[data-report]');
    const list = panel.querySelector('[data-report-list]');
    const changedResults = report.results.filter(hasAnswerChanges);

    list.replaceChildren();
    changedResults.forEach((result) => {
      const item = document.createElement('li');
      const status = result.success ? '已修改并验证' : `修改未完成：${result.reason}`;
      const title = document.createElement('span');
      title.textContent = `第 ${result.questionNumber ?? '?'} 题（${result.type}，ID ${result.problemId}）：${status}`;
      item.appendChild(title);

      if (Object.hasOwn(result, 'previousAnswer')) {
        const comparison = document.createElement('div');
        const targetAnswer = result.type === 'true_false' && typeof result.targetAnswer === 'boolean'
          ? String(result.targetAnswer)
          : formatAnswer(result.targetAnswer);
        comparison.textContent = `原答案：${formatAnswer(result.previousAnswer)}；本次目标：${targetAnswer}`;
        item.appendChild(comparison);
      }

      const changes = result.optionActions || result.blankActions;
      if (changes?.length) {
        const details = document.createElement('ul');
        changes.filter((change) => change.action === 'checked'
          || change.action === 'unchecked'
          || change.action === 'updated').forEach((change) => {
          const detail = document.createElement('li');
          const label = result.optionActions ? `选项 ${change.option}` : `填空 ${change.index + 1}`;
          const actionLabels = { checked: '已勾选', unchecked: '已取消', updated: '已修改' };
          detail.textContent = `${label}：${actionLabels[change.action]}`;
          details.appendChild(detail);
        });
        item.appendChild(details);
      }
      list.appendChild(item);
    });
    container.hidden = changedResults.length === 0;
    if (changedResults.length) container.open = true;
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
      panel.querySelector('[data-auto-save]').checked = config.autoApplyAnswers === true;
      panel.querySelector('[data-diagnostic-logging]').checked = config.diagnosticLoggingEnabled === true;
      panel.querySelector('[data-diagnostics]').hidden = !config.diagnosticLoggingEnabled;
    } catch (error) {
      setLog(panel, error.message || '无法读取 AI 配置');
    }
  }

  async function openSettings(panel) {
    await sendRuntimeMessage({ type: 'open-ai-settings' });
    state.aiConfig = null;
    setStatus(panel, 'AI 配置页已打开');
    setLog(panel, '请在新标签页中完成并保存模型服务配置。');
  }

  async function loadQuestions(panel, extractedQuestions) {
    try {
      const result = extractedQuestions || await window.PintiaAssistantExtract();
      state.questions = result.questions;
      state.problemSetId = result.problemSetId;
      const types = [...new Set(state.questions.map((question) => question.type))];
      panel.querySelector('[data-types]').innerHTML = `<span>处理题型</span>${types.map((type) => `<label><input type="checkbox" value="${type}" checked />${typeLabels[type] || type}</label>`).join('')}`;
    } catch (error) {
      panel.querySelector('[data-types]').innerHTML = '<span>处理题型</span><em>题库读取失败</em>';
      setLog(panel, error.message || '无法读取题库。');
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
    setStatus(panel, '提示词已复制');
    setLog(panel, '可将提示词粘贴至兼容的 AI 服务。');
  }

  async function requestApiAnswer(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    const button = panel.querySelector('[data-action="api"]');
    const autoSaveToggle = panel.querySelector('[data-auto-save]');
    let autoApplyAnswers;
    button.disabled = true;
    autoSaveToggle.disabled = true;
    try {
      await state.configReady;
      autoApplyAnswers = autoSaveToggle.checked;
      const { config } = await sendRuntimeMessage({ type: 'get-ai-config' });
      state.aiConfig = config;
      const diagnosticLoggingEnabled = panel.querySelector('[data-diagnostic-logging]').checked;
      const diagnosticDetails = panel.querySelector('[data-diagnostics]');
      diagnosticDetails.hidden = !diagnosticLoggingEnabled;
      const diagnosticList = panel.querySelector('[data-diagnostic-list]');
      diagnosticList.replaceChildren();
      const requestId = crypto.randomUUID();
      state.activeAiRequestId = requestId;
      state.aiPhase = '初稿';
      state.aiPhaseStartedAt = Date.now();
      state.aiElapsedTimer = window.setInterval(() => updateAiElapsed(panel), 1000);
      updateAiElapsed(panel);
      diagnosticLog(panel, 'AI 请求开始');
      const input = promptApi.buildInput(document.title, questions, state.problemSetId);
      const questionMetadata = questions.map((question) => {
        const rawId = question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id;
        const options = question.options || [];
        return {
          problemId: rawId === undefined || rawId === null ? null : String(rawId),
          questionNumber: question.number ?? null,
          type: question.type,
          optionLabels: options.length <= 26
            ? options.map((_, index) => String.fromCharCode(65 + index))
            : []
        };
      });
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'ask-ai',
          input,
          questions: questionMetadata,
          problemSetId: state.problemSetId,
          requestId
        }, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });
      if (response?.error) throw new Error(response.error);
      if (typeof response?.text !== 'string' || !response.text.trim()) throw new Error('API 未返回答案文本。');
      panel.querySelector('[data-answer]').value = response.text;
      if (response.secondaryError) {
        setStatus(panel, '答案复核未完成，未执行自动回填');
        setLog(panel, `${response.secondaryError} 答案编辑区保留第一阶段草稿，请核对后再手动回填。`);
        return;
      }
      if (autoApplyAnswers) {
        setStatus(panel, '最终答案已生成，正在自动回填并保存');
        setLog(panel, response.secondaryChecked
          ? '答案复核已完成，正在校验最终答案并按所选题型回填。'
          : '正在校验模型答案并按所选题型回填。');
        await applyAnswers(panel, { save: true });
        return;
      }
      setStatus(panel, response.secondaryChecked ? '答案复核完成，最终答案已载入' : '答案已载入');
      setLog(panel, response.secondaryChecked
        ? '复核后的最终答案已载入答案编辑区。请核对 JSON 内容，再点击“校验并回填”。'
        : '模型答案已载入答案编辑区。请核对 JSON 内容，再点击“校验并回填”。');
    } finally {
      if (state.aiElapsedTimer) window.clearInterval(state.aiElapsedTimer);
      state.aiElapsedTimer = null;
      state.activeAiRequestId = null;
      state.aiPhase = null;
      state.aiPhaseStartedAt = 0;
      button.disabled = false;
      autoSaveToggle.disabled = false;
    }
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
    setLog(panel, `正在导出包含 ${result.questions.length} 道题目的 JSON 文件。`);
  }

  async function applyAnswers(panel, options = {}) {
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
      const answerCount = answers.answers.filter((answer) => selectedTypes.includes(answer.type)).length;
      if (!answerCount) throw new Error('答案 JSON 中没有已勾选题型的答案。');
      const save = options.save ?? panel.querySelector('[data-auto-save]').checked;
      setStatus(panel, '正在校验并回填答案');
      const report = await window.PintiaAnswerRunner.run(answers, selectedTypes, { save });
      const { total, success, failed, skipped } = report.summary;
      setStatus(panel, report.success
        ? report.saved ? '答案已回填并保存' : '答案已回填，尚未保存'
        : '回填流程已完成，部分题目未处理');
      updateReport(panel, report);
      const changedCount = report.results.filter(hasAnswerChanges).length;
      const saveMessage = report.saved
        ? '已执行保存'
        : report.saveRequested
          ? '没有成功执行保存'
          : '本次未触发保存（如有修改，仍留在页面）';
      const changeMessage = changedCount ? `实际修改 ${changedCount} 道题` : '本次没有题目内容发生变化';
      const message = `答案项 ${total}；成功 ${success}；失败 ${failed}；跳过 ${skipped}；${changeMessage}；${saveMessage}。`;
      state.latestReport = { report, message };
      setLog(panel, message);
    } finally {
      button.disabled = false;
    }
  }

  function enableDragging(panel) {
    const head = panel.querySelector('.pintia-assistant-head');
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let ignoreNextCollapseClick = false;
    head.addEventListener('pointerdown', (event) => {
      const collapseButton = event.target.closest('[data-action="collapse"]');
      const collapsedBadge = panel.classList.contains('is-collapsed') && collapseButton;
      if (event.target.closest('button') && !collapsedBadge) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panel.classList.add('is-dragging');
      (collapsedBadge ? collapseButton : head).setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, head.offsetHeight));
      panel.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
      panel.style.right = 'auto';
    });
    const stopDragging = () => {
      if (moved) {
        ignoreNextCollapseClick = true;
        window.setTimeout(() => { ignoreNextCollapseClick = false; }, 0);
      }
      dragging = false;
      panel.classList.remove('is-dragging');
    };
    head.addEventListener('pointerup', stopDragging);
    head.addEventListener('pointercancel', stopDragging);
    panel.addEventListener('click', (event) => {
      if (!ignoreNextCollapseClick || !event.target.closest('[data-action="collapse"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ignoreNextCollapseClick = false;
    }, true);
  }

  function bindPanel(panel) {
    panel.addEventListener('change', async (event) => {
      const target = event.target;
      if (target.matches('[data-diagnostic-logging]')) {
        panel.querySelector('[data-diagnostics]').hidden = !target.checked;
      }
      if (!target.matches('[data-auto-save], [data-diagnostic-logging]')) return;
      try {
        await sendRuntimeMessage({
          type: 'save-assistant-options',
          autoApplyAnswers: panel.querySelector('[data-auto-save]').checked,
          diagnosticLoggingEnabled: panel.querySelector('[data-diagnostic-logging]').checked
        });
      } catch (error) {
        setLog(panel, error.message || '无法保存助手选项。');
      }
    });
    panel.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      try {
        if (action === 'collapse') {
          const collapsed = panel.classList.toggle('is-collapsed');
          state.collapsed = collapsed;
          const button = panel.querySelector('[data-action="collapse"]');
          button.title = collapsed ? '展开' : '收起';
          button.setAttribute('aria-label', collapsed ? '展开答案助手' : '收起答案助手');
          await chrome.storage.local.set({ assistantCollapsed: collapsed });
        }
        if (action === 'close') panel.remove();
        if (action === 'settings') await openSettings(panel);
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'api') await requestApiAnswer(panel);
        if (action === 'export') await exportQuestionBank(panel);
        if (action === 'apply') await applyAnswers(panel);
      } catch (error) {
        setStatus(panel, '操作未完成');
        setLog(panel, error.message || '执行过程中发生错误。');
      }
    });
  }

  async function open(extractedQuestions) {
    await state.panelStateReady;
    const existingPanel = document.querySelector('#pintia-assistant-panel');
    const panel = existingPanel || createPanel(extractedQuestions);
    if (existingPanel && extractedQuestions) await loadQuestions(panel, extractedQuestions);
    panel.hidden = false;
    return panel;
  }

  window.PintiaAssistant = {
    open,
    async refreshQuestions(extractedQuestions) {
      const panel = document.querySelector('#pintia-assistant-panel');
      if (panel) await loadQuestions(panel, extractedQuestions);
    },
    async toggle() {
      const panel = document.querySelector('#pintia-assistant-panel');
      if (!panel) {
        await open();
        return true;
      }
      panel.hidden = !panel.hidden;
      return !panel.hidden;
    },
    isVisible() {
      const panel = document.querySelector('#pintia-assistant-panel');
      return Boolean(panel && !panel.hidden);
    }
  };

  window.PintiaAssistantExtract = async () => {
    const result = await window.PintiaExtractor.extractFromApi();
    return { title: document.title, problemSetId: result.problemSetId, questions: result.questions };
  };
})();
