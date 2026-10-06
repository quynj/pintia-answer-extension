(() => {
  const promptApi = window.PintiaPrompt;
  const state = {
    questions: [],
    problemSetId: null,
    aiConfig: null,
    latestReport: null
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
        <strong>Pintia 学习助手</strong>
        <div><button data-action="settings" title="AI 配置">AI 配置</button><button data-action="collapse" title="收起">−</button><button data-action="close" title="关闭">×</button></div>
      </div>
      <div class="pintia-assistant-body" data-view="assistant">
        <p class="pintia-assistant-status" data-status>请选择要处理的题型</p>
        <div class="pintia-assistant-types" data-types><span>处理题型</span><em>正在读取题库…</em></div>
        <div class="pintia-assistant-save-options" data-save-options hidden>
          <label for="pintia-assistant-save-mode">是否自动保存</label>
          <select id="pintia-assistant-save-mode" data-save-mode>
            <option value="save">是，自动保存</option>
            <option value="keep">否，仅修改页面</option>
          </select>
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
      </div>`;
    document.body.appendChild(panel);
    bindPanel(panel);
    enableDragging(panel);
    if (state.latestReport) {
      updateReport(panel, state.latestReport.report, state.latestReport.selectedTypes);
      setLog(panel, state.latestReport.message);
    }
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

  function updateSaveOptions(panel) {
    const selectedCount = panel.querySelectorAll('[data-types] input:checked').length;
    panel.querySelector('[data-save-options]').hidden = selectedCount !== 1;
  }

  function formatAnswer(answer) {
    if (answer === null || answer === undefined) return '未作答';
    if (Array.isArray(answer)) return answer.length ? answer.join('、') : '未选择';
    if (typeof answer === 'boolean') return answer ? '是' : '否';
    return String(answer);
  }

  function updateReport(panel, report, selectedTypes) {
    const container = panel.querySelector('[data-report]');
    const list = panel.querySelector('[data-report-list]');
    const includedIds = new Set(report.results.map((result) => result.problemId));
    const unreportedQuestions = state.questions.filter((question) =>
      selectedTypes.includes(question.type) && question.id && !includedIds.has(question.id));
    const entries = [
      ...report.results.map((result) => ({ result })),
      ...unreportedQuestions.map((question) => ({ question }))
    ];

    list.replaceChildren();
    entries.forEach(({ result, question }) => {
      const item = document.createElement('li');
      if (result) {
        const status = result.skipped
          ? `跳过：${result.reason}`
          : result.success
            ? result.action === 'unchanged' ? '已与目标答案一致，未修改' : '已修改并验证'
            : `失败：${result.reason}`;
        const title = document.createElement('span');
        title.textContent = `第 ${result.questionNumber ?? '?'} 题（${result.type}，ID ${result.problemId}）：${status}`;
        item.appendChild(title);

        if (Object.hasOwn(result, 'previousAnswer')) {
          const comparison = document.createElement('div');
          comparison.textContent = `原答案：${formatAnswer(result.previousAnswer)}；本次目标：${formatAnswer(result.targetAnswer)}`;
          item.appendChild(comparison);
        }

        const changes = result.optionActions || result.blankActions;
        if (changes?.length) {
          const details = document.createElement('ul');
          changes.forEach((change) => {
            const detail = document.createElement('li');
            const label = result.optionActions ? `选项 ${change.option}` : `填空 ${change.index + 1}`;
            const actionLabels = {
              checked: '已勾选',
              unchecked: '已取消',
              already_checked: '原已勾选，未操作',
              already_unchecked: '原未勾选，未操作',
              updated: '已修改',
              unchanged: '内容未变，未操作'
            };
            detail.textContent = `${label}：${actionLabels[change.action] || change.action}`;
            details.appendChild(detail);
          });
          item.appendChild(details);
        }
      } else {
        item.textContent = `第 ${question.number ?? '?'} 题（${question.type}）：答案 JSON 未包含此题，未操作`;
      }
      list.appendChild(item);
    });
    container.hidden = entries.length === 0;
    if (entries.length) container.open = true;
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
    setStatus(panel, 'AI 配置页已打开');
    setLog(panel, '请在新标签页中完成并保存模型服务配置。');
  }

  async function loadQuestions(panel) {
    try {
      const result = await window.PintiaAssistantExtract();
      state.questions = result.questions;
      state.problemSetId = result.problemSetId;
      const types = [...new Set(state.questions.map((question) => question.type))];
      panel.querySelector('[data-types]').innerHTML = `<span>处理题型</span>${types.map((type) => `<label><input type="checkbox" value="${type}" checked />${typeLabels[type] || type}</label>`).join('')}`;
      updateSaveOptions(panel);
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
    button.disabled = true;
    try {
      setStatus(panel, '正在生成答案');
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
      if (response.secondaryError) {
        setStatus(panel, '答案复核未完成，未执行自动回填');
        setLog(panel, `${response.secondaryError} 答案编辑区保留第一阶段草稿，请核对后再手动回填。`);
        return;
      }
      if (response.autoApplyAnswers) {
        setStatus(panel, '最终答案已生成，正在自动回填并保存');
        setLog(panel, response.secondaryChecked
          ? '答案复核已完成，正在校验最终答案并按所选题型回填。'
          : '正在校验模型答案并按所选题型回填。');
        await applyAnswers(panel);
        return;
      }
      setStatus(panel, response.secondaryChecked ? '答案复核完成，最终答案已载入' : '答案已载入');
      setLog(panel, response.secondaryChecked
        ? '复核后的最终答案已载入答案编辑区。请核对 JSON 内容，再点击“校验并回填”。'
        : '模型答案已载入答案编辑区。请核对 JSON 内容，再点击“校验并回填”。');
    } finally {
      button.disabled = false;
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
      const answerCount = answers.answers.filter((answer) => selectedTypes.includes(answer.type)).length;
      if (!answerCount) throw new Error('答案 JSON 中没有已勾选题型的答案。');
      const save = selectedTypes.length !== 1
        || panel.querySelector('[data-save-mode]').value === 'save';
      setStatus(panel, '正在校验并回填答案');
      const report = await window.PintiaAnswerRunner.run(answers, selectedTypes, { save });
      const { total, success, failed, skipped } = report.summary;
      setStatus(panel, report.success
        ? report.saved ? '答案已回填并保存' : '答案已回填，尚未保存'
        : '回填流程已完成，部分题目未处理');
      updateReport(panel, report, selectedTypes);
      const saveMessage = report.saved
        ? '已执行保存'
        : report.saveRequested
          ? '没有成功执行保存'
          : '本次未触发保存（如有修改，仍留在页面）';
      const message = `答案项 ${total}；成功 ${success}；失败 ${failed}；跳过 ${skipped}；${saveMessage}。展开“回填明细”查看逐题对照及未包含题目。`;
      state.latestReport = { report, selectedTypes, message };
      setLog(panel, message);
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
    panel.addEventListener('change', (event) => {
      if (event.target.closest('[data-types]')) updateSaveOptions(panel);
    });
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
        setStatus(panel, '操作未完成');
        setLog(panel, error.message || '执行过程中发生错误。');
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
