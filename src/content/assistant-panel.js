(() => {
  const promptApi = window.PintiaPrompt;
  const state = {
    questions: [],
    problemSetId: null,
    aiConfig: null,
    activeAiRequestId: null,
    aiMessageSentRequestId: null,
    aiPhase: null,
    aiPhaseStartedAt: 0,
    aiElapsedTimer: null,
    aiTimerRequestId: null,
    programmingLanguage: '',
    loggingEnabled: false,
    logs: [],
    configReady: Promise.resolve(),
    collapsed: true,
    panelStateReady: chrome.storage.local.get('assistantCollapsed').then(({ assistantCollapsed }) => {
      if (typeof assistantCollapsed === 'boolean') state.collapsed = assistantCollapsed;
    })
  };

  const typeLabels = {
    MULTIPLE_CHOICE: '单选题',
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: '多选题',
    TRUE_OR_FALSE: '判断题',
    FILL_IN_THE_BLANK: '填空题',
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: '程序填空题',
    PROGRAMMING: '编程题',
    SQL_PROGRAMMING: 'SQL编程题',
    SUBJECTIVE: '主观题'
  };

  function isProgrammingQuestion(question) {
    return question.type === 'PROGRAMMING' || question.type === 'SQL_PROGRAMMING';
  }

  const programmingLanguages = [
    'C',
    'C++',
    'Java',
    'Python 3',
    'JavaScript (Node.js)',
    'TypeScript (Node.js)',
    'C#',
    'Go',
    'Rust',
    'Kotlin',
    'Swift',
    'PHP',
    'Ruby',
    'R',
    'SQL'
  ];

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
      <p class="pintia-assistant-context" data-page-context></p>
        <div class="pintia-assistant-types" data-types><span>处理题型</span><em>正在读取题库…</em></div>
        <div class="pintia-assistant-programming-language" data-programming-language hidden>
          <label for="pintia-assistant-programming-language">编程语言</label>
          <select id="pintia-assistant-programming-language" data-language>
            <option value="">请选择本次实现语言</option>
            ${programmingLanguages.map((language) => `<option value="${language}">${language}</option>`).join('')}
          </select>
          <small>AI 将按此语言生成代码。Pintia 编辑器不会自动切换，请手动选择相同语言后再输入。</small>
        </div>
        <div class="pintia-assistant-options">
          <label><input type="checkbox" data-auto-save />自动回填并保存</label>
          <label><input type="checkbox" data-diagnostic-logging />开启日志</label>
          <small>范围跟随上方勾选题型，支持单选、多选、判断、填空（含程序填空）、编程（SQL编程和普通编程）题型，主观题暂不支持答案回填页面。注意，编程题需进入具体题目代码编辑器页面。</small>
        </div>
        <label class="pintia-assistant-answer-label" for="pintia-assistant-answer">答案内容（JSON）</label>
        <p class="pintia-assistant-answer-hint">配置自定义模型后，AI 生成结果会显示在此处，或你也可以粘贴符合回填答案的json格式数据。</p>
        <textarea id="pintia-assistant-answer" data-answer placeholder="等待答案JSON投喂..."></textarea>
        <div class="pintia-assistant-actions">
          <button data-action="prompt">复制提示词</button>
          <button data-action="api">AI 生成答案</button>
          <button data-action="export">导出题库</button>
          <button data-action="apply">校验并回填/输入</button>
        </div>
        <details class="pintia-review-export" data-review-export>
          <summary>导出选项</summary>
          <label data-review-delay-option hidden>请求间隔（毫秒）
            <input type="number" min="0" max="10000" step="100" value="300" data-review-delay />
          </label>
          <div class="pintia-review-loader">
            <div class="pintia-review-loader-copy">
              <strong>作业题目集</strong>
              <small data-review-count aria-live="polite">尚未加载题目集</small>
            </div>
            <button data-action="load-review-sets"><span aria-hidden="true">↻</span><span data-loader-label>加载题目集</span></button>
          </div>
          <div data-review-sets aria-live="polite"></div>
          <label class="pintia-review-answers"><input type="checkbox" data-review-include-answers checked />包含作答内容</label>
          <button class="pintia-review-export-button" data-action="export-review-sets" disabled>导出 Markdown</button>
          <small>普通题型作答仅来自平台返回的最近提交，不含标准答案；主观题、编程题及 SQL 编程题的作答内容暂不支持导出。只请求作业实际包含的题型；无法确认评测结果时标记为未评测，图片使用在线地址。</small>
        </details>
        <p class="pintia-assistant-log-message" data-log-message></p>
        <section class="pintia-assistant-console" data-log-panel hidden>
          <header><strong>运行日志</strong><span data-log-count>0</span></header>
          <div data-log-console role="log" aria-live="polite" aria-relevant="additions"></div>
        </section>
      </div>`;
    const collapseButton = panel.querySelector('[data-action="collapse"]');
    collapseButton.title = state.collapsed ? '展开' : '收起';
    collapseButton.setAttribute('aria-label', state.collapsed ? '展开答案助手' : '收起答案助手');
    document.body.appendChild(panel);
    bindPanel(panel);
    enableDragging(panel);
    renderLogs(panel);
    loadQuestions(panel, extractedQuestions);
    state.configReady = loadConfig(panel);
    return panel;
  }

  function setStatus(panel, message) {
    panel.querySelector('[data-status]').textContent = message;
  }

  function setLog(panel, message, level = 'info') {
    panel.querySelector('[data-log-message]').textContent = message;
    appendLog(panel, message, level);
  }

  function renderLogs(panel) {
    const logPanel = panel.querySelector('[data-log-panel]');
    const consoleElement = panel.querySelector('[data-log-console]');
    logPanel.hidden = !state.loggingEnabled;
    consoleElement.replaceChildren();
    state.logs.forEach((entry) => {
      const line = document.createElement('div');
      line.className = `pintia-assistant-console-line is-${entry.level}`;
      line.textContent = `${entry.time} [${entry.level.toUpperCase()}] ${entry.message}`;
      consoleElement.appendChild(line);
    });
    panel.querySelector('[data-log-count]').textContent = String(state.logs.length);
    consoleElement.scrollTop = consoleElement.scrollHeight;
  }

  function appendLog(panel, message, level = 'info') {
    if (!state.loggingEnabled) return;
    const entry = {
      time: new Date().toLocaleTimeString(),
      level,
      message: String(message)
    };
    state.logs.push(entry);
    if (state.logs.length > 200) state.logs.shift();
    const activePanel = panel?.isConnected ? panel : document.querySelector('#pintia-assistant-panel');
    if (!activePanel) return;
    const consoleElement = activePanel.querySelector('[data-log-console]');
    const line = document.createElement('div');
    line.className = `pintia-assistant-console-line is-${level}`;
    line.textContent = `${entry.time} [${level.toUpperCase()}] ${entry.message}`;
    consoleElement.appendChild(line);
    if (consoleElement.childElementCount > 200) consoleElement.firstElementChild.remove();
    activePanel.querySelector('[data-log-count]').textContent = String(state.logs.length);
    activePanel.querySelector('[data-log-panel]').hidden = false;
    consoleElement.scrollTop = consoleElement.scrollHeight;
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
      appendLog(panel, `${state.aiPhase}请求开始`, 'info');
      return;
    }

    const stage = message.phase.startsWith('draft-') ? '初稿' : '复核';
    const duration = `${((message.durationMs || 0) / 1000).toFixed(1)} 秒`;
    if (message.phase.endsWith('-completed')) {
      appendLog(panel, `${stage}请求完成，耗时 ${duration}`, 'success');
    } else if (message.phase.endsWith('-failed')) {
      const reasons = {
        timeout: '超时',
        cancelled: '已取消',
        'invalid-output': '结果校验失败',
        'request-failed': '请求失败'
      };
      appendLog(panel, `${stage}${reasons[message.reason] || '未完成'}，耗时 ${duration}`, 'error');
    }
  });

  function hasAnswerChanges(result) {
    return result.action === 'updated'
      || result.optionActions?.some(({ action }) => action === 'checked' || action === 'unchecked')
      || result.blankActions?.some(({ action }) => action === 'updated');
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
      state.loggingEnabled = config.diagnosticLoggingEnabled === true;
      renderLogs(panel);
    } catch (error) {
      setLog(panel, error.message || '无法读取 AI 配置', 'error');
    }
  }

  async function openSettings(panel) {
    await sendRuntimeMessage({ type: 'open-ai-settings' });
    state.aiConfig = null;
    setStatus(panel, 'AI 配置页已打开');
    setLog(panel, '请在新标签页中完成并保存模型服务配置。');
  }

  function syncCurrentProblemSetSelection(panel, problemSet) {
    const problemSetId = problemSet?.id;
    if (!problemSetId) return;
    const list = panel.querySelector('[data-review-sets]');
    if (!list) return;
    const setId = String(problemSetId);
    const existingSet = state.reviewProblemSets?.find((set) => String(set.id) === setId);
    const currentSet = {
      ...existingSet,
      id: setId,
      name: problemSet.name || existingSet?.name || `当前题目集（${setId}）`,
      examId: problemSet.examId || existingSet?.examId || null,
      isCurrentOnly: !existingSet || existingSet.isCurrentOnly === true
    };
    state.reviewProblemSets = [
      ...(state.reviewProblemSets || []).filter((set) => String(set.id) !== setId),
      currentSet
    ];
    let checkbox = [...list.querySelectorAll('[data-review-set]')]
      .find((input) => String(input.value) === setId);
    if (!checkbox) {
      const label = document.createElement('label');
      label.dataset.currentProblemSet = '';
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = setId;
      checkbox.dataset.reviewSet = '';
      const text = document.createElement('span');
      label.append(checkbox, text);
      list.prepend(label);
    }
    checkbox.disabled = !currentSet.examId;
    checkbox.checked = !checkbox.disabled;
    checkbox.parentElement.querySelector('span').textContent =
      `${currentSet.name || '当前题目集'}${currentSet.examId ? '' : '（缺少考试 ID）'}`;
    panel.querySelector('[data-action="export-review-sets"]').disabled =
      !state.reviewProblemSets.some((set) => set.examId);
    panel.querySelector('[data-review-count]').textContent = `已识别当前题目集`;
    updateReviewDelayVisibility(panel);
  }

  async function loadQuestions(panel, extractedQuestions) {
    try {
      const result = extractedQuestions || await window.PintiaAssistantExtract();
      state.questions = result.questions;
      state.problemSetId = result.problemSetId;
      if (result.problemSetId) {
        syncCurrentProblemSetSelection(panel, {
          id: result.problemSetId,
          name: result.title,
          examId: result.examId
        });
      }
      const hasCurrentQuestionSet = state.questions.length > 0;
      setStatus(panel, hasCurrentQuestionSet ? '作业题目已就绪' : '当前页未检测到作业题目');
      panel.querySelector('[data-page-context]').textContent = hasCurrentQuestionSet
        ? '当前为作业题目页：可使用 AI、回填及当前题库导出。作业 Markdown 导出也可在任意已登录的 Pintia 页面使用。'
        : '当前非作业题目页：可加载作业列表并导出 Markdown；AI 答题、回填和当前题库导出需进入具体作业题目页。';
      for (const action of ['prompt', 'api', 'export', 'apply']) {
        const button = panel.querySelector(`[data-action="${action}"]`);
        if (button) button.disabled = !hasCurrentQuestionSet;
      }
      const types = [...new Set(state.questions.map((question) => question.type))];
      panel.querySelector('[data-types]').innerHTML = `<span>处理题型</span>${types.map((type) => `<label><input type="checkbox" value="${type}" checked />${typeLabels[type] || type}</label>`).join('')}`;
      const languageSelector = panel.querySelector('[data-programming-language]');
      const languageControl = panel.querySelector('[data-language]');
      const hasProgrammingQuestions = state.questions.some(isProgrammingQuestion);
      languageSelector.hidden = !hasProgrammingQuestions;
      if (hasProgrammingQuestions) {
        try {
          const { programmingLanguage } = await chrome.storage.local.get('programmingLanguage');
          if (!languageControl.value && programmingLanguages.includes(programmingLanguage)) {
            state.programmingLanguage = programmingLanguage;
            languageControl.value = programmingLanguage;
          }
        } catch (error) {
          setLog(panel, error.message || '无法读取已保存的编程语言。', 'error');
        }
      }
      const incompleteProgrammingCount = state.questions
        .filter((question) => isProgrammingQuestion(question) && !question.hasStatement)
        .length;
      if (incompleteProgrammingCount) {
        setLog(panel, `${incompleteProgrammingCount} 道编程题未读取到完整题干；复制提示词和 AI 请求暂不可用。`);
      }
    } catch (error) {
      panel.querySelector('[data-types]').innerHTML = '<span>处理题型</span><em>题库读取失败</em>';
      setLog(panel, error.message || '无法读取题库。', 'error');
    }
  }

  function selectedQuestions(panel) {
    const selected = new Set([...panel.querySelectorAll('[data-types] input:checked')].map((input) => input.value));
    return state.questions.filter((question) => selected.has(question.type));
  }

  function requireProgrammingStatements(questions) {
    if (questions.some(isProgrammingQuestion) && !state.programmingLanguage) {
      throw new Error('请先选择编程语言，并手动将 Pintia 编辑器切换到相同语言。');
    }
    const missing = questions.filter((question) => isProgrammingQuestion(question) && !question.hasStatement);
    if (missing.length) {
      throw new Error(`有 ${missing.length} 道编程题未能读取完整题干；请确认题目详情接口可用后重新检测。`);
    }
  }

  function requireChoiceOptions(questions) {
    const missing = questions.filter((question) =>
      (question.type === 'MULTIPLE_CHOICE' || question.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER')
      && !question.options?.length
    );
    if (missing.length) {
      const numbers = missing.map((question) => question.number ?? question.id ?? '未知题号').join('、');
      throw new Error(`选择题 ${numbers} 未读取到选项，无法生成可靠答案；请重新检测题库。`);
    }
  }

  async function copyPrompt(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    requireProgrammingStatements(questions);
    requireChoiceOptions(questions);
    if (!state.aiConfig) await loadConfig(panel);
    const prompt = promptApi.build(
      document.title,
      questions,
      state.problemSetId,
      state.aiConfig?.prompt,
      state.programmingLanguage
    );
    await navigator.clipboard.writeText(prompt);
    setStatus(panel, '提示词已复制');
    setLog(panel, '可将提示词粘贴至兼容的 AI 服务。');
  }

  async function requestApiAnswer(panel) {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    requireProgrammingStatements(questions);
    requireChoiceOptions(questions);
    const button = panel.querySelector('[data-action="api"]');
    const autoSaveToggle = panel.querySelector('[data-auto-save]');
    const requestId = crypto.randomUUID();
    let autoApplyAnswers;
    state.activeAiRequestId = requestId;
    button.disabled = true;
    autoSaveToggle.disabled = true;
    try {
      await state.configReady;
      if (state.activeAiRequestId !== requestId) return;
      autoApplyAnswers = autoSaveToggle.checked;
      const { config } = await sendRuntimeMessage({ type: 'get-ai-config' });
      if (state.activeAiRequestId !== requestId) return;
      state.aiConfig = config;
      state.aiPhase = '初稿';
      state.aiPhaseStartedAt = Date.now();
      state.aiTimerRequestId = requestId;
      state.aiElapsedTimer = window.setInterval(() => updateAiElapsed(panel), 1000);
      updateAiElapsed(panel);
      appendLog(panel, `AI 请求开始（${questions.length} 道题）`);
      const input = promptApi.buildInput(
        document.title,
        questions,
        state.problemSetId,
        state.programmingLanguage
      );
      const questionMetadata = questions.map((question) => {
        const rawId = question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id;
        const options = question.options || [];
        const fillBlankConfig = question.apiData?.problemConfig?.fillInTheBlankProblemConfig
          || question.apiData?.problemConfig?.fillInTheBlankForProgrammingProblemConfig
          || question.problemConfig?.fillInTheBlankProblemConfig
          || question.problemConfig?.fillInTheBlankForProgrammingProblemConfig;
        return {
          problemId: rawId === undefined || rawId === null ? null : String(rawId),
          questionNumber: question.number ?? null,
          type: question.type,
          ...(question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
            && Array.isArray(fillBlankConfig?.blanks)
            ? { fillBlankCount: fillBlankConfig.blanks.length }
            : {}),
          optionLabels: options.length <= 26
            ? options.map((_, index) => String.fromCharCode(65 + index))
            : []
        };
      });
      const response = await new Promise((resolve, reject) => {
        state.aiMessageSentRequestId = requestId;
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
      if (state.activeAiRequestId !== requestId) return;
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
      if (state.aiTimerRequestId === requestId) {
        if (state.aiElapsedTimer) window.clearInterval(state.aiElapsedTimer);
        state.aiElapsedTimer = null;
        state.aiTimerRequestId = null;
        state.aiPhase = null;
        state.aiPhaseStartedAt = 0;
      }
      if (state.activeAiRequestId === requestId) state.activeAiRequestId = null;
      if (state.aiMessageSentRequestId === requestId) state.aiMessageSentRequestId = null;
      button.disabled = false;
      autoSaveToggle.disabled = false;
    }
  }

  async function exportQuestionBank(panel) {
    setStatus(panel, '正在导出题库');
    const { result } = await sendRuntimeMessage({ type: 'get-question-bank' });
    const filename = (result.problemSetName || result.title || document.title || 'pintia-question-bank')
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

  function reviewRequestDelay(panel) {
    const input = panel.querySelector('[data-review-delay]');
    const delay = Number(input.value);
    if (!Number.isInteger(delay) || delay < 0 || delay > 10000) {
      throw new Error('请求间隔必须是 0 到 10000 毫秒之间的整数。');
    }
    return delay;
  }

  function expandedImageMarkdown(value) {
    return String(value || '').replace(/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)\s*(\))/g, (match, prefix, source, suffix) => {
      const imagePath = source.replace(/^<|>$/g, '');
      if (!/^\/?~\//.test(imagePath)) return match;
      const path = imagePath.replace(/^\/?~\//, '').split('/').map(encodeURIComponent).join('/');
      return `${prefix}<https://images.ptausercontent.com/${path}>${suffix}`;
    });
  }

  function questionMarkdown(question) {
    const questionContent = question.type === 'FILL_IN_THE_BLANK'
      || question.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
      ? window.PintiaExtractor.fillBlankMarkdownContent(question)
      : question.content || question.prompt;
    const content = expandedImageMarkdown(questionContent);
    const imageUrls = [...new Set((question.images || [])
      .filter((image) => image.location !== 'option' && image.url && !content.includes(image.url))
      .map((image) => image.url))];
    return [content, ...imageUrls.map((url) => `![题目图片](<${url}>)`)]
      .filter(Boolean)
      .join('\n\n');
  }

  function answerText(answer) {
    if (answer === undefined || answer === null || answer === '') return '（未提供作答内容）';
    if (Array.isArray(answer)) return answer.map((item) => String(item)).join('、');
    if (typeof answer === 'object') return JSON.stringify(answer);
    return String(answer);
  }

  function codeFence(value) {
    const longest = Math.max(0, ...(String(value).match(/`+/g) || []).map((part) => part.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${value}\n${fence}`;
  }

  function reviewMarkdown(result, includeAnswers = true) {
    const questionsByType = new Map();
    result.questions.forEach((question) => {
      const type = question.type;
      if (!questionsByType.has(type)) questionsByType.set(type, []);
      questionsByType.get(type).push(question);
    });
    const lines = [
      `# ${result.title}`,
      '',
      `- 导出时间：${new Date().toLocaleString()}`,
      `- 来源：${result.source}`,
      `- 题目数：${result.questions.length}`,
      '',
      `> 说明：只展示平台返回的评测状态${includeAnswers ? '和作答' : ''}；未评测或无法识别的状态不会推断为正确或错误。`,
      ''
    ];
    for (const [type, questions] of questionsByType) {
      lines.push(`## ${typeLabels[type] || type}`, '');
      questions.forEach((question, index) => {
        const submission = question.submission;
        const evaluation = submission?.evaluation;
        const mark = evaluation === 'wrong' ? '❌ 错题' : evaluation === 'correct' ? '✅ 正确' : '⚪ 未评测/未知';
        lines.push(`### ${question.number ?? index + 1}. ${mark}`, '');
        lines.push(questionMarkdown(question), '');
        if (question.options?.length) {
          lines.push(...question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${expandedImageMarkdown(option)}`), '');
        }
        if (includeAnswers) {
          lines.push(`**我的作答：** ${isProgrammingQuestion(question)
            ? `\n\n${codeFence(answerText(submission?.answer))}`
            : answerText(submission?.answer)}`);
        }
        if (evaluation === 'wrong') lines.push('', '**复习标记：** 错题（平台未提供可用标准答案）');
        else if (!submission) lines.push('', '**作答记录：** 未找到匹配的提交记录');
        lines.push('');
      });
    }
    return lines.join('\n');
  }

  function reviewFilename(result) {
    const filename = (result.title || 'pintia-review')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80) || 'pintia-review';
    return `${filename}.md`;
  }

  function downloadReviewMarkdown(result, includeAnswers) {
    return sendRuntimeMessage({
      type: 'download-review-markdown',
      filename: reviewFilename(result),
      markdown: reviewMarkdown(result, includeAnswers)
    });
  }

  async function exportSelectedReviewSets(panel) {
    const selectedIds = new Set([...panel.querySelectorAll('[data-review-set]:checked')].map((input) => input.value));
    const problemSets = state.reviewProblemSets?.filter((set) => selectedIds.has(String(set.id))) || [];
    if (!problemSets.length) throw new Error('请至少选择一套可导出的作业。');
    const delay = problemSets.length > 1 ? reviewRequestDelay(panel) : 300;
    const includeAnswers = panel.querySelector('[data-review-include-answers]').checked;
    if (problemSets.length > 1) {
      await chrome.storage.local.set({ reviewExportRequestDelayMs: delay });
    }
    const button = panel.querySelector('[data-action="export-review-sets"]');
    button.disabled = true;
    let exportedCount = 0;
    try {
      setLog(panel, `开始导出 ${problemSets.length} 套题目集，请求间隔 ${delay} 毫秒。`);
      for (const problemSet of problemSets) {
        setStatus(panel, `正在导出：${problemSet.name}`);
        appendLog(panel, `读取题目集：${problemSet.name || '未命名题目集'}`);
        const { result } = await sendRuntimeMessage({
          type: 'export-review-problem-set',
          problemSet,
          requestDelayMs: delay
        });
        const download = await downloadReviewMarkdown(result, includeAnswers);
        exportedCount += 1;
        setLog(panel, `下载完成：${download.filename}（${exportedCount}/${problemSets.length}）。`);
      }
      setStatus(panel, '复习 Markdown 导出完成');
      setLog(panel, `Markdown 导出完成，共 ${exportedCount} 个文件。`);
    } catch (error) {
      setStatus(panel, '复习导出未全部完成');
      setLog(panel, `已导出 ${exportedCount} 个文件后失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function updateReviewDelayVisibility(panel) {
    panel.querySelector('[data-review-delay-option]').hidden =
      panel.querySelectorAll('[data-review-set]:checked').length <= 1;
  }

  async function loadReviewProblemSets(panel, currentSetId = null, automatic = false) {
    const button = panel.querySelector('[data-action="load-review-sets"]');
    if (button.disabled) return;
    const delay = reviewRequestDelay(panel);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (!automatic) {
      setStatus(panel, '正在加载题目集');
      setLog(panel, '开始加载题目集列表。');
    }
    panel.querySelector('[data-review-count]').textContent = '正在获取数量…';
    button.querySelector('[data-loader-label]').textContent = '正在加载…';
    try {
      await chrome.storage.local.set({ reviewExportRequestDelayMs: delay });
      const { problemSets } = await sendRuntimeMessage({
        type: 'list-review-problem-sets',
        requestDelayMs: delay
      });
      const uniqueProblemSets = [...new Map(
        problemSets.map((problemSet) => [String(problemSet.id), problemSet])
      ).values()];
      const currentSet = state.reviewProblemSets?.find(
        (problemSet) => String(problemSet.id) === String(state.problemSetId)
      );
      if (currentSet && !uniqueProblemSets.some((problemSet) => String(problemSet.id) === String(currentSet.id))) {
        uniqueProblemSets.push(currentSet);
      }
      const selectedIds = new Set(
        [...panel.querySelectorAll('[data-review-set]:checked')].map((input) => input.value)
      );
      const selectedCurrentSetId = state.problemSetId || currentSetId;
      if (selectedCurrentSetId) selectedIds.add(String(selectedCurrentSetId));
      state.reviewProblemSets = uniqueProblemSets;
      const list = panel.querySelector('[data-review-sets]');
      list.replaceChildren();
      uniqueProblemSets.forEach((problemSet) => {
        const label = document.createElement('label');
        if (problemSet.isCurrentOnly) label.dataset.currentProblemSet = '';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = problemSet.id;
        checkbox.dataset.reviewSet = '';
        checkbox.disabled = !problemSet.examId;
        checkbox.checked = selectedIds.has(String(problemSet.id)) && !checkbox.disabled;
        const text = document.createElement('span');
        text.textContent = `${problemSet.name || '未命名作业'}${problemSet.examId ? '' : '（缺少考试 ID）'}`;
        label.append(checkbox, text);
        list.appendChild(label);
      });
      updateReviewDelayVisibility(panel);
      panel.querySelector('[data-action="export-review-sets"]').disabled = !uniqueProblemSets.some((set) => set.examId);
      panel.querySelector('[data-review-count]').textContent = `已加载 ${uniqueProblemSets.length} 套题目集`;
      if (!automatic) {
        setStatus(panel, '题目集列表已加载');
        setLog(panel, `找到 ${uniqueProblemSets.length} 套题目集；没有考试 ID 的题目集无法导出。`);
      }
    } catch (error) {
      panel.querySelector('[data-review-count]').textContent = '加载失败，请重试';
      throw error;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.querySelector('[data-loader-label]').textContent = '加载题目集';
    }
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
      const forcedBatchSave = !save && window.PintiaAnswerRunner.requiresBatchSave(answers, selectedTypes);
      if (forcedBatchSave && !window.confirm(
        '答案包含多种可回填题型，Pintia 切换题型时可能阻止离开未保存的页面。为避免答案丢失，本次将逐类保存，即使“自动回填并保存”未勾选。是否继续？'
      )) {
        setStatus(panel, '已取消回填');
        setLog(panel, '未开始回填；页面答案未修改或保存。');
        return;
      }
      setStatus(panel, selectedTypes.includes('PROGRAMMING') || selectedTypes.includes('SQL_PROGRAMMING')
        ? '正在校验答案并逐字输入编程代码'
        : '正在校验并回填答案');
      setLog(panel, `开始回填 ${answerCount} 道题，题型：${selectedTypes.join('、')}。`);
      const report = await window.PintiaAnswerRunner.run(answers, selectedTypes, { save });
      const { total, success, failed, skipped } = report.summary;
      setStatus(panel, report.success
        ? report.saved ? '答案已回填并保存' : '答案已回填，尚未保存'
        : '答案输入/回填流程已完成，部分题目未处理');
      report.results.forEach((result) => {
        const question = `第 ${result.questionNumber ?? '?'} 题（${typeLabels[result.type] || result.type}）`;
        const message = result.success
          ? `${question}：${hasAnswerChanges(result) ? '已修改并验证' : '答案已验证，无需修改'}`
          : `${question}：${result.skipped ? '已跳过' : '失败'}${result.reason ? `，${result.reason}` : ''}`;
        appendLog(panel, message, result.success ? 'success' : result.skipped ? 'warn' : 'error');
      });
      const changedCount = report.results.filter(hasAnswerChanges).length;
      const saveMessage = report.saved
        ? '已执行保存'
        : report.saveRequested
          ? '没有成功执行保存'
          : '本次未触发保存（如有修改，仍留在页面）';
      const changeMessage = changedCount ? `实际修改 ${changedCount} 道题` : '本次没有题目内容发生变化';
      const batchSaveMessage = forcedBatchSave ? '多题型安全保护要求逐类保存' : '';
      const message = `答案项 ${total}；成功 ${success}；失败 ${failed}；跳过 ${skipped}；${changeMessage}；${saveMessage}${batchSaveMessage ? `；${batchSaveMessage}` : ''}。`;
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
    let pointerId = null;
    let ignoreNextCollapseClick = false;
    const moveDragging = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, head.offsetHeight));
      panel.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
      panel.style.right = 'auto';
    };
    const stopDragging = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      if (moved) {
        ignoreNextCollapseClick = true;
        window.setTimeout(() => { ignoreNextCollapseClick = false; }, 0);
      }
      dragging = false;
      pointerId = null;
      panel.classList.remove('is-dragging');
      window.removeEventListener('pointermove', moveDragging);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || dragging) return;
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
      pointerId = event.pointerId;
      panel.classList.add('is-dragging');
      window.addEventListener('pointermove', moveDragging);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
      if (!collapsedBadge) event.preventDefault();
    });
    panel.addEventListener('click', (event) => {
      if (!ignoreNextCollapseClick || !event.target.closest('[data-action="collapse"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ignoreNextCollapseClick = false;
    }, true);
  }

  function bindPanel(panel) {
    chrome.storage.local.get('reviewExportRequestDelayMs').then(({ reviewExportRequestDelayMs }) => {
      if (Number.isInteger(reviewExportRequestDelayMs) && reviewExportRequestDelayMs >= 0 && reviewExportRequestDelayMs <= 10000) {
        panel.querySelector('[data-review-delay]').value = String(reviewExportRequestDelayMs);
      }
    }).catch((error) => setLog(panel, error.message || '无法读取复习导出设置。', 'error'));
    panel.addEventListener('change', async (event) => {
      const target = event.target;
      if (target.matches('[data-review-set]')) {
        updateReviewDelayVisibility(panel);
        return;
      }
      if (target.matches('[data-language]')) {
        state.programmingLanguage = target.value;
        try {
          await chrome.storage.local.set({ programmingLanguage: target.value });
          if (target.value) {
            setLog(panel, `已选择 ${target.value}；请手动将 Pintia 代码编辑器切换为相同语言。`);
          }
        } catch (error) {
          setLog(panel, error.message || '无法保存编程语言选项。', 'error');
        }
        return;
      }
      if (target.matches('[data-diagnostic-logging]')) {
        if (target.checked) {
          state.loggingEnabled = true;
          renderLogs(panel);
          appendLog(panel, '日志已开启。');
        } else {
          appendLog(panel, '日志已关闭。');
          state.loggingEnabled = false;
          renderLogs(panel);
        }
      }
      if (!target.matches('[data-auto-save], [data-diagnostic-logging]')) return;
      try {
        await sendRuntimeMessage({
          type: 'save-assistant-options',
          autoApplyAnswers: panel.querySelector('[data-auto-save]').checked,
          diagnosticLoggingEnabled: panel.querySelector('[data-diagnostic-logging]').checked
        });
      } catch (error) {
        if (target.matches('[data-diagnostic-logging]')) {
          state.loggingEnabled = !target.checked;
          target.checked = state.loggingEnabled;
          renderLogs(panel);
        }
        setLog(panel, error.message || '无法保存助手选项。', 'error');
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
        if (action === 'close') {
          const requestId = state.activeAiRequestId;
          const answerExists = Boolean(panel.querySelector('[data-answer]').value.trim());
          if (requestId || answerExists) {
            const message = requestId
              ? 'AI 任务正在准备或生成，关闭将取消本次任务；面板中的答案内容也不会保留。仍要关闭？'
              : '面板中已有答案内容，关闭后重新打开时不会恢复。仍要关闭？';
            if (!window.confirm(message)) return;
          }
          if (requestId && state.aiMessageSentRequestId === requestId) {
            await sendRuntimeMessage({ type: 'cancel-ai', requestId });
          }
          if (state.activeAiRequestId === requestId) state.activeAiRequestId = null;
          panel.remove();
          return;
        }
        if (action === 'settings') await openSettings(panel);
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'api') await requestApiAnswer(panel);
        if (action === 'export') await exportQuestionBank(panel);
        if (action === 'load-review-sets') await loadReviewProblemSets(panel);
        if (action === 'export-review-sets') await exportSelectedReviewSets(panel);
        if (action === 'apply') await applyAnswers(panel);
      } catch (error) {
        if (action === 'load-review-sets') {
          panel.querySelector('[data-review-count]').textContent = '加载失败，请重试';
        }
        setStatus(panel, '操作未完成');
        setLog(panel, error.message || '执行过程中发生错误。', 'error');
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
    clearCurrentProblemSet() {
      const panel = document.querySelector('#pintia-assistant-panel');
      if (!panel) return;
      panel.querySelectorAll('[data-current-problem-set]').forEach((label) => label.remove());
      state.reviewProblemSets = state.reviewProblemSets?.filter((set) => !set.isCurrentOnly) || [];
      state.problemSetId = null;
      panel.querySelector('[data-review-count]').textContent = state.reviewProblemSets?.length
        ? `已加载 ${state.reviewProblemSets.length} 套题目集`
        : '尚未加载题目集';
      updateReviewDelayVisibility(panel);
      panel.querySelector('[data-action="export-review-sets"]').disabled =
        !state.reviewProblemSets?.some((set) => set.examId);
    },
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
    return {
      title: result.problemSetName || document.title,
      problemSetId: result.problemSetId,
      problemSetName: result.problemSetName,
      examId: result.examId,
      questions: result.questions
    };
  };
})();
