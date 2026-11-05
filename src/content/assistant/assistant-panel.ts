import { answerRunner } from '../answer/answer-runner';
import { pintiaExtractor } from '../extraction/api-extractor';
import { questionTypes } from '../question-types';
import { createAssistantLog } from './assistant-log';
import { createReviewExportPanel } from './review-export-panel';
import assistantPanelTemplate from './assistant-panel.template.html';
import { promptBuilder } from '../../shared/prompt-builder';
import type {
  AiConfig,
  AnswerRunResult,
  PintiaAssistantApi,
  PintiaProblemSet,
  PintiaQuestion,
  PintiaQuestionBankResult
} from '../../shared/types';

const promptApi = promptBuilder;
const { labels: typeLabels, isProgramming: isProgrammingQuestion } = questionTypes;
type AiPhase = '初稿' | '复核';
type ExtractionProgress = {
  phase?: string;
  type?: string;
  typeIndex?: number;
  typeCount?: number;
  detailCompleted?: number;
  detailTotal?: number;
  message?: string;
};
type AnswerAction = { action: string };
type AnswerRunItem = AnswerRunResult;
type AssistantState = {
  questions: PintiaQuestion[];
  problemSetId: string | null;
  aiConfig: AiConfig | null;
  apiKeyConfigured: boolean;
  activeAiRequestId: string | null;
  aiMessageSentRequestId: string | null;
  aiPhase: AiPhase | null;
  aiPhaseStartedAt: number;
  aiElapsedTimer: ReturnType<typeof setInterval> | null;
  aiTimerRequestId: string | null;
  programmingLanguage: string;
  dismissedPageUrl: string | null;
  configReady: Promise<void>;
  collapsed: boolean;
  reviewProblemSets: PintiaProblemSet[];
  panelStateReady: Promise<void>;
};
const assistantLog = createAssistantLog();

function errorMessage(error: unknown, fallback = '发生未知错误。'): string {
  return error instanceof Error ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAiConfig(value: unknown): value is AiConfig {
  if (!isRecord(value)) return false;
  return (value.apiType === 'chat-completions' || value.apiType === 'responses')
    && typeof value.endpoint === 'string'
    && typeof value.model === 'string'
    && typeof value.apiKey === 'string'
    && typeof value.prompt === 'string'
    && typeof value.autoApplyAnswers === 'boolean'
    && typeof value.requestTimeoutSeconds === 'number'
    && typeof value.secondaryCheckEnabled === 'boolean'
    && typeof value.secondaryPrompt === 'string'
    && typeof value.useSeparateVerifierConfig === 'boolean';
}

function isAiConfigReady(config: AiConfig | null, apiKeyConfigured = Boolean(config?.apiKey.trim())): boolean {
  if (!config || !apiKeyConfigured || !config.model.trim()) return false;
  try {
    const endpoint = new URL(config.endpoint);
    return endpoint.protocol === 'http:' || endpoint.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPintiaQuestion(value: unknown): value is PintiaQuestion {
  return isRecord(value) && typeof value.type === 'string';
}

function isQuestionBankResult(value: unknown): value is PintiaQuestionBankResult {
  return isRecord(value)
    && Array.isArray(value.questions)
    && value.questions.every(isPintiaQuestion);
}

function isProblemSet(value: unknown): value is PintiaProblemSet {
  return isRecord(value)
    && (typeof value.id === 'string' || typeof value.id === 'number')
    && typeof value.name === 'string';
}

  const state: AssistantState = {
    questions: [],
    problemSetId: null,
    aiConfig: null,
    apiKeyConfigured: false,
    activeAiRequestId: null,
    aiMessageSentRequestId: null,
    aiPhase: null,
    aiPhaseStartedAt: 0,
    aiElapsedTimer: null,
    aiTimerRequestId: null,
    programmingLanguage: '',
    dismissedPageUrl: null,
    configReady: Promise.resolve(),
    collapsed: true,
    reviewProblemSets: [],
    panelStateReady: chrome.storage.local.get('assistantCollapsed').then(({ assistantCollapsed }) => {
      if (typeof assistantCollapsed === 'boolean') state.collapsed = assistantCollapsed;
    })
  };

  function requiredElement<T extends HTMLElement>(panel: HTMLElement, selector: string): T {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`答案助手面板缺少元素：${selector}`);
    return element;
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

  function createPanel(extractedQuestions?: PintiaQuestionBankResult): HTMLElement {
    const existingPanel = document.getElementById('pintia-assistant-panel');
    if (existingPanel) return existingPanel;
    const panel = document.createElement('aside');
    panel.id = 'pintia-assistant-panel';
    panel.classList.toggle('is-collapsed', state.collapsed);
    const programmingLanguageOptions = programmingLanguages
      .map((language) => `<option value="${language}">${language}</option>`)
      .join('');
    panel.innerHTML = assistantPanelTemplate.replace(
      '<!-- programming-language-options -->',
      programmingLanguageOptions
    );
    const collapseButton = panel.querySelector<HTMLButtonElement>('[data-action="collapse"]');
    if (!collapseButton) throw new Error('答案助手面板缺少收起按钮。');
    collapseButton.title = state.collapsed ? '展开' : '收起';
    collapseButton.setAttribute('aria-label', state.collapsed ? '展开答案助手' : '收起答案助手');
    document.body.appendChild(panel);
    bindTabs(panel);
    bindPanel(panel);
    enableDragging(panel);
    renderLogs(panel);
    if (extractedQuestions) loadQuestions(panel, extractedQuestions);
    state.configReady = loadConfig(panel);
    return panel;
  }

  function setStatus(panel: HTMLElement, message: string): void {
    requiredElement(panel, '[data-status]').textContent = message;
  }

  function setLog(panel: HTMLElement, message: string, level = 'info'): void {
    assistantLog.set(panel, message, level);
  }

  function updateAiGenerateControl(panel: HTMLElement): void {
    const control = requiredElement<HTMLButtonElement>(panel, '[data-action="generate"]');
    const configReady = isAiConfigReady(state.aiConfig, state.apiKeyConfigured);
    const hasGenerationTypes = panel.querySelector('[data-generate-types] input:checked') !== null;
    control.disabled = !state.questions.length || !configReady || !hasGenerationTypes || state.activeAiRequestId !== null;
    requiredElement(panel, '[data-auto-save-option]').hidden = state.activeAiRequestId === null;
    control.title = !state.questions.length
      ? '等待题目读取完成'
      : !configReady
        ? '请先在 AI 配置页填写并保存有效配置'
        : hasGenerationTypes
        ? ''
        : '请至少选择一种生成题型';
  }

  function renderLogs(panel: HTMLElement): void {
    assistantLog.render(panel);
  }

  function appendLog(panel: HTMLElement | null, message: string, level = 'info'): void {
    assistantLog.append(panel, message, level);
  }

  function bindTabs(panel: HTMLElement): void {
    const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab]')];
    const selectTab = (selectedTab: HTMLButtonElement): void => {
      tabs.forEach((tab) => {
        const selected = tab === selectedTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        const tabPanel = panel.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`);
        if (tabPanel) tabPanel.hidden = !selected;
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', (event: KeyboardEvent) => {
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        selectTab(nextTab);
        nextTab.focus();
      });
    });
  }

  function updateAiElapsed(panel: HTMLElement): void {
    if (!state.aiPhase || !state.aiPhaseStartedAt) return;
    const seconds = Math.floor((Date.now() - state.aiPhaseStartedAt) / 1000);
    const phaseLabel = state.aiPhase === '复核' ? '初稿已返回，正在请求复核' : '正在请求初稿';
    setStatus(panel, `${phaseLabel}（已等待 ${seconds} 秒）`);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'ai-progress' || message.requestId !== state.activeAiRequestId) return;
    const panel = document.getElementById('pintia-assistant-panel');
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
      const reasons: Record<string, string> = {
        timeout: '超时',
        cancelled: '已取消',
        'invalid-output': '结果校验失败',
        'request-failed': '请求失败'
      };
      appendLog(panel, `${stage}${reasons[message.reason] || '未完成'}，耗时 ${duration}`, 'error');
    }
  });

  function hasAnswerChanges(result: AnswerRunItem): boolean {
    return Boolean(result.action === 'updated'
      || result.optionActions?.some(({ action }) => action === 'checked' || action === 'unchecked')
      || result.blankActions?.some(({ action }) => action === 'updated'));
  }

  function sendRuntimeMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!isRecord(response)) reject(new Error('后台返回了无效响应。'));
        else if (typeof response.error === 'string') reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  const reviewExportPanel = createReviewExportPanel({
    state,
    requiredElement,
    isQuestionBankResult,
    isProblemSet,
    sendRuntimeMessage,
    setStatus,
    setLog,
    appendLog,
    errorMessage
  });

  async function loadConfig(panel: HTMLElement): Promise<void> {
    try {
      const response = await sendRuntimeMessage({ type: 'get-ai-config' });
      if (!isAiConfig(response.config) || typeof response.apiKeyConfigured !== 'boolean') {
        throw new Error('后台返回了无效的 AI 配置。');
      }
      const config = response.config;
      state.aiConfig = config;
      state.apiKeyConfigured = response.apiKeyConfigured;
      requiredElement<HTMLInputElement>(panel, '[data-auto-save]').checked = config.autoApplyAnswers === true;
      renderLogs(panel);
      updateAiGenerateControl(panel);
    } catch (error) {
      state.aiConfig = null;
      state.apiKeyConfigured = false;
      updateAiGenerateControl(panel);
      setLog(panel, errorMessage(error, '无法读取 AI 配置'), 'error');
    }
  }

  function refreshAiConfigWhenVisible(): void {
    if (document.visibilityState !== 'visible') return;
    const panel = document.getElementById('pintia-assistant-panel');
    if (panel && state.aiConfig === null) {
      state.configReady = loadConfig(panel);
    }
  }

  window.addEventListener('focus', refreshAiConfigWhenVisible);
  document.addEventListener('visibilitychange', refreshAiConfigWhenVisible);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.aiConfig) return;
    const panel = document.getElementById('pintia-assistant-panel');
    if (!panel) return;
    state.configReady = loadConfig(panel);
  });

  async function openSettings(panel: HTMLElement): Promise<void> {
    await sendRuntimeMessage({ type: 'open-ai-settings' });
    state.aiConfig = null;
    state.apiKeyConfigured = false;
    updateAiGenerateControl(panel);
    setStatus(panel, 'AI 配置页已打开');
    setLog(panel, '请在新标签页中完成并保存模型服务配置。');
  }

  function syncCurrentProblemSetSelection(panel: HTMLElement, problemSet: PintiaProblemSet): void {
    const problemSetId = problemSet?.id;
    if (!problemSetId) return;
    const list = requiredElement(panel, '[data-review-sets]');
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
    let checkbox = [...list.querySelectorAll<HTMLInputElement>('[data-review-set]')]
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
    const label = checkbox.closest('label');
    if (!label) throw new Error('题目集选项缺少标签。');
    requiredElement<HTMLSpanElement>(label, 'span').textContent =
      `${currentSet.name || '当前题目集'}${currentSet.examId ? '' : '（缺少考试 ID）'}`;
    requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-sets"]').disabled =
      !state.reviewProblemSets.some((set) => set.examId);
    requiredElement(panel, '[data-review-count]').textContent = '已识别当前题目集';
    reviewExportPanel.updateReviewDelayVisibility(panel);
  }

  async function loadQuestions(panel: HTMLElement, extractedQuestions?: PintiaQuestionBankResult): Promise<void> {
    try {
      const result: PintiaQuestionBankResult = extractedQuestions ?? await pintiaExtractor.extractFromApi().then((extraction) => ({
        ...extraction,
        title: extraction.problemSetName || document.title,
        source: location.href
      }));
      state.questions = result.questions;
      state.problemSetId = result.problemSetId ?? null;
      if (result.problemSetId) {
        syncCurrentProblemSetSelection(panel, {
          id: result.problemSetId,
          name: result.title || document.title,
          examId: result.examId
        });
      }
      const hasCurrentQuestionSet = state.questions.length > 0;
      setStatus(panel, hasCurrentQuestionSet ? '作业题目已就绪' : '当前页未检测到作业题目');
      for (const action of ['prompt', 'export', 'apply']) {
        const button = panel.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
        if (button) button.disabled = !hasCurrentQuestionSet;
      }
      updateAiGenerateControl(panel);
      const types = [...new Set(state.questions.map((question) => question.type))];
      renderQuestionTypes(panel, '[data-generate-types]', types);
      renderQuestionTypes(panel, '[data-fill-types]', types);
      updateAiGenerateControl(panel);
      const languageSelector = requiredElement(panel, '[data-programming-language]');
      const languageControl = requiredElement<HTMLSelectElement>(panel, '[data-language]');
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
          setLog(panel, error instanceof Error ? error.message : '无法读取已保存的编程语言。', 'error');
        }
      }
      const incompleteProgrammingCount = state.questions
        .filter((question) => isProgrammingQuestion(question) && !question.hasStatement)
        .length;
      if (incompleteProgrammingCount) {
        setLog(panel, `${incompleteProgrammingCount} 道编程题未读取到完整题干；复制提示词和 AI 请求暂不可用。`);
      }
    } catch (error) {
      for (const selector of ['[data-generate-types]', '[data-fill-types]']) {
        requiredElement(panel, selector).textContent = '题库读取失败';
      }
      setLog(panel, error instanceof Error ? error.message : '无法读取题库。', 'error');
    }
  }

  function showExtractionProgress(progress: ExtractionProgress = {}): void {
    const panel = document.getElementById('pintia-assistant-panel');
    if (!panel) return;
    const showTypeMessage = (message: string): void => {
      for (const selector of ['[data-generate-types]', '[data-fill-types]']) {
        const detail = document.createElement('em');
        detail.textContent = message;
        requiredElement(panel, selector).replaceChildren(detail);
      }
    };
    if (progress.phase === 'starting') {
      setStatus(panel, '正在读取题目');
      showTypeMessage('正在读取题型和题目列表…');
    } else if (progress.phase === 'type') {
      const type = progress.type || '';
      const label = typeLabels[type] || type;
      setStatus(panel, `正在读取${label}（${progress.typeIndex}/${progress.typeCount}）`);
      showTypeMessage(`${label}：正在获取题目列表…`);
    } else if (progress.phase === 'details') {
      const type = progress.type || '';
      const label = typeLabels[type] || type;
      setStatus(panel, `正在读取${label}详情（${progress.detailCompleted}/${progress.detailTotal}）`);
      showTypeMessage(`${label}详情 ${progress.detailCompleted}/${progress.detailTotal}`);
    } else if (progress.phase === 'type-complete') {
      const type = progress.type || '';
      const label = typeLabels[type] || type;
      setStatus(panel, `已读取${label}（${progress.typeIndex}/${progress.typeCount}）`);
      showTypeMessage(`${label}已完成，准备读取下一题型…`);
    } else if (progress.phase === 'error') {
      setStatus(panel, '题目读取失败');
      showTypeMessage('读取失败');
      setLog(panel, progress.message || '题目读取失败。', 'error');
    }
  }

  function selectedQuestions(panel: HTMLElement): PintiaQuestion[] {
    const selected = new Set([...panel.querySelectorAll<HTMLInputElement>('[data-generate-types] input:checked')].map((input) => input.value));
    return state.questions.filter((question) => selected.has(question.type));
  }

  function selectedFillTypes(panel: HTMLElement): string[] {
    return [...panel.querySelectorAll<HTMLInputElement>('[data-fill-types] input:checked')]
      .map((input) => input.value);
  }

  function renderQuestionTypes(panel: HTMLElement, selector: string, types: string[]): void {
    const container = requiredElement(panel, selector);
    container.replaceChildren();
    types.forEach((type) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = type;
      input.checked = true;
      const name = document.createElement('span');
      name.textContent = typeLabels[type] || type;
      label.append(input, name);
      container.appendChild(label);
    });
  }

  function requireProgrammingStatements(questions: PintiaQuestion[]): void {
    if (questions.some(isProgrammingQuestion) && !state.programmingLanguage) {
      throw new Error('请先选择编程语言，并手动将 Pintia 编辑器切换到相同语言。');
    }
    const missing = questions.filter((question) => isProgrammingQuestion(question) && !question.hasStatement);
    if (missing.length) {
      throw new Error(`有 ${missing.length} 道编程题未能读取完整题干；请确认题目详情接口可用后重新检测。`);
    }
  }

  function requireChoiceOptions(questions: PintiaQuestion[]): void {
    const missing = questions.filter((question) =>
      (question.type === 'MULTIPLE_CHOICE' || question.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER')
      && !question.options?.length
    );
    if (missing.length) {
      const numbers = missing.map((question) => question.number ?? question.id ?? '未知题号').join('、');
      throw new Error(`选择题 ${numbers} 未读取到选项，无法生成可靠答案；请重新检测题库。`);
    }
  }

  async function copyPrompt(panel: HTMLElement): Promise<void> {
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

  async function requestApiAnswer(panel: HTMLElement): Promise<void> {
    const questions = selectedQuestions(panel);
    if (!questions.length) throw new Error('请至少选择一种题型。');
    requireProgrammingStatements(questions);
    requireChoiceOptions(questions);
    const control = requiredElement<HTMLButtonElement>(panel, '[data-action="generate"]');
    const autoSaveToggle = requiredElement<HTMLInputElement>(panel, '[data-auto-save]');
    const requestId = crypto.randomUUID();
    state.activeAiRequestId = requestId;
    control.disabled = true;
    try {
      await state.configReady;
      if (state.activeAiRequestId !== requestId) return;
      const configResponse = await sendRuntimeMessage({ type: 'get-ai-config' });
      if (!isAiConfig(configResponse.config) || typeof configResponse.apiKeyConfigured !== 'boolean') {
        throw new Error('后台返回了无效的 AI 配置。');
      }
      const config = configResponse.config;
      if (state.activeAiRequestId !== requestId) return;
      state.aiConfig = config;
      state.apiKeyConfigured = configResponse.apiKeyConfigured;
      if (!isAiConfigReady(config, state.apiKeyConfigured)) {
        throw new Error('请先在 AI 配置页填写有效的 API 地址、模型名称和 API Key。');
      }
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
      const responseValue: unknown = await new Promise((resolve, reject) => {
        state.aiMessageSentRequestId = requestId;
        chrome.runtime.sendMessage({
          type: 'ask-ai',
          input,
          questions: questionMetadata,
          problemSetId: state.problemSetId,
          requestId
        }, (result: unknown) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });
      if (state.activeAiRequestId !== requestId) return;
      if (!isRecord(responseValue)) throw new Error('后台返回了无效的 AI 响应。');
      if (typeof responseValue.error === 'string') throw new Error(responseValue.error);
      if (typeof responseValue.text !== 'string' || !responseValue.text.trim()) {
        throw new Error('API 未返回答案文本。');
      }
      const answerText = responseValue.text;
      const response = responseValue;
      requiredElement<HTMLTextAreaElement>(panel, '[data-answer]').value = answerText;
      if (typeof response.secondaryError === 'string') {
        setStatus(panel, '答案复核未完成，未执行自动回填');
        setLog(panel, `${response.secondaryError} 答案编辑区保留第一阶段草稿，请核对后再手动回填。`);
        return;
      }
      const secondaryChecked = response.secondaryChecked === true;
      if (autoSaveToggle.checked) {
        const fillTypes = selectedFillTypes(panel);
        const generatedAnswers = answerRunner.parse(answerText, state.problemSetId);
        const matchingAnswerCount = generatedAnswers.answers
          .filter((answer) => fillTypes.includes(answer.type)).length;
        if (!matchingAnswerCount) {
          setStatus(panel, secondaryChecked ? '答案已复核并载入' : '答案已载入');
          setLog(panel, fillTypes.length
            ? '生成题型与回填题型没有共同答案；答案已载入编辑区，未执行自动回填。'
            : '尚未选择回填题型；答案已载入编辑区，未执行自动回填。');
          return;
        }
        setStatus(panel, '最终答案已生成，正在自动回填并保存');
        setLog(panel, secondaryChecked
          ? '答案复核已完成，正在校验最终答案并按所选题型回填。'
          : '正在校验模型答案并按所选题型回填。');
        await applyAnswers(panel, { save: true });
        return;
      }
      setStatus(panel, secondaryChecked ? '答案复核完成，最终答案已载入' : '答案已载入');
      setLog(panel, secondaryChecked
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
      updateAiGenerateControl(panel);
      autoSaveToggle.disabled = false;
    }
  }

  async function exportQuestionBank(panel: HTMLElement): Promise<void> {
    setStatus(panel, '正在导出题库');
    const response = await sendRuntimeMessage({ type: 'get-question-bank' });
    if (!isQuestionBankResult(response.result)) throw new Error('后台返回了无效的题库数据。');
    const result = response.result;
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

  async function applyAnswers(panel: HTMLElement, options: { save?: boolean } = {}): Promise<void> {
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="apply"]');
    button.disabled = true;
    try {
      const answers = answerRunner.parse(
        requiredElement<HTMLTextAreaElement>(panel, '[data-answer]').value,
        state.problemSetId
      );
      const selectedTypes = selectedFillTypes(panel);
      if (!selectedTypes.length) throw new Error('请至少选择一种回填题型。');
      const answerCount = answers.answers.filter((answer) => selectedTypes.includes(answer.type)).length;
      if (!answerCount) throw new Error('答案 JSON 中没有已勾选题型的答案。');
      const save = options.save ?? requiredElement<HTMLInputElement>(panel, '[data-auto-save]').checked;
      const forcedBatchSave = !save && answerRunner.requiresBatchSave(answers, selectedTypes);
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
      const report = await answerRunner.run(answers, selectedTypes, { save });
      const { total, success, failed, skipped } = report.summary;
      setStatus(panel, report.success
        ? report.saved ? '答案已回填并保存' : '答案已回填，尚未保存'
        : '答案输入/回填流程已完成，部分题目未处理');
      report.results.forEach((result: AnswerRunResult) => {
        const type = result.type || '';
        const question = `第 ${result.questionNumber ?? '?'} 题（${typeLabels[type] || type}）`;
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

  function enableDragging(panel: HTMLElement): void {
    const head = requiredElement<HTMLElement>(panel, '.pintia-assistant-head');
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let pointerId: number | null = null;
    let ignoreNextCollapseClick = false;
    const moveDragging = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - Math.min(rect.height, head.offsetHeight));
      panel.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
      panel.style.right = 'auto';
    };
    const stopDragging = (event: PointerEvent) => {
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
    head.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || dragging) return;
      const target = event.target;
      const collapseButton = target instanceof Element ? target.closest('[data-action="collapse"]') : null;
      const collapsedBadge = panel.classList.contains('is-collapsed') && collapseButton;
      if (target instanceof Element && target.closest('button') && !collapsedBadge) return;
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
    panel.addEventListener('click', (event: MouseEvent) => {
      if (!(event.target instanceof Element)
        || !ignoreNextCollapseClick
        || !event.target.closest('[data-action="collapse"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ignoreNextCollapseClick = false;
    }, true);
  }

  function bindPanel(panel: HTMLElement): void {
    chrome.storage.local.get(['reviewExportRequestDelayMs', 'problemDetailRequestDelayMs'])
      .then(({ reviewExportRequestDelayMs, problemDetailRequestDelayMs }) => {
        if (Number.isInteger(reviewExportRequestDelayMs) && reviewExportRequestDelayMs >= 0 && reviewExportRequestDelayMs <= 10000) {
          requiredElement<HTMLInputElement>(panel, '[data-review-delay]').value = String(reviewExportRequestDelayMs);
        }
        if (Number.isInteger(problemDetailRequestDelayMs) && problemDetailRequestDelayMs >= 0 && problemDetailRequestDelayMs <= 10000) {
          requiredElement<HTMLInputElement>(panel, '[data-problem-detail-delay]').value = String(problemDetailRequestDelayMs);
        }
      }).catch((error) => setLog(panel, errorMessage(error, '无法读取导出设置。'), 'error'));
    panel.addEventListener('change', async (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches('[data-generate-types] input')) {
        updateAiGenerateControl(panel);
        return;
      }
      if (target.matches('[data-review-delay], [data-problem-detail-delay]')) {
        try {
          const detailDelay = target.matches('[data-problem-detail-delay]');
          const delay = detailDelay
            ? reviewExportPanel.problemDetailRequestDelay(panel)
            : reviewExportPanel.reviewProblemSetInterval(panel);
          await chrome.storage.local.set({
            [detailDelay ? 'problemDetailRequestDelayMs' : 'reviewExportRequestDelayMs']: delay
          });
          setLog(panel, `${detailDelay ? '题目详情间隔' : '题集间隔'}已保存：${delay} 毫秒。`);
        } catch (error) {
          setLog(panel, errorMessage(error, '无法保存请求间隔设置。'), 'error');
        }
        return;
      }
      if (target.matches('[data-review-set]')) {
        reviewExportPanel.updateReviewDelayVisibility(panel);
        return;
      }
      if (target.matches('[data-language]')) {
        if (!(target instanceof HTMLSelectElement)) return;
        state.programmingLanguage = target.value;
        try {
          await chrome.storage.local.set({ programmingLanguage: target.value });
          if (target.value) {
            setLog(panel, `已选择 ${target.value}；请手动将 Pintia 代码编辑器切换为相同语言。`);
          }
        } catch (error) {
          setLog(panel, errorMessage(error, '无法保存编程语言选项。'), 'error');
        }
        return;
      }
      if (!target.matches('[data-auto-save]')) return;
      if (!(target instanceof HTMLInputElement)) return;
      try {
        await sendRuntimeMessage({
          type: 'save-assistant-options',
          autoApplyAnswers: requiredElement<HTMLInputElement>(panel, '[data-auto-save]').checked
        });
      } catch (error) {
        setLog(panel, errorMessage(error, '无法保存助手选项。'), 'error');
      }
    });
    panel.addEventListener('click', async (event: MouseEvent) => {
      const action = event.target instanceof Element
        ? (event.target.closest('[data-action]') as HTMLElement | null)?.dataset.action
        : undefined;
      if (!action) return;
      try {
        if (action === 'collapse') {
          const collapsed = panel.classList.toggle('is-collapsed');
          state.collapsed = collapsed;
          const button = requiredElement<HTMLButtonElement>(panel, '[data-action="collapse"]');
          button.title = collapsed ? '展开' : '收起';
          button.setAttribute('aria-label', collapsed ? '展开答案助手' : '收起答案助手');
          await chrome.storage.local.set({ assistantCollapsed: collapsed });
        }
        if (action === 'close') {
          const requestId = state.activeAiRequestId;
          const answerExists = Boolean(requiredElement<HTMLTextAreaElement>(panel, '[data-answer]').value.trim());
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
          if (state.aiMessageSentRequestId === requestId) state.aiMessageSentRequestId = null;
          if (state.aiElapsedTimer) window.clearInterval(state.aiElapsedTimer);
          state.aiElapsedTimer = null;
          state.aiTimerRequestId = null;
          state.aiPhase = null;
          state.aiPhaseStartedAt = 0;
          state.questions = [];
          state.problemSetId = null;
          state.reviewProblemSets = [];
          assistantLog.clear();
          state.dismissedPageUrl = location.href;
          panel.remove();
          return;
        }
        if (action === 'settings') await openSettings(panel);
        if (action === 'prompt') await copyPrompt(panel);
        if (action === 'generate') {
          requiredElement<HTMLInputElement>(panel, '[data-auto-save]').checked = true;
          requiredElement(panel, '[data-auto-save-option]').hidden = false;
          try {
            await requestApiAnswer(panel);
          } finally {
            updateAiGenerateControl(panel);
          }
        }
        if (action === 'export') await exportQuestionBank(panel);
        if (action === 'load-review-sets') await reviewExportPanel.loadReviewProblemSets(panel);
        if (action === 'export-review-sets') await reviewExportPanel.exportSelectedReviewSets(panel);
        if (action === 'apply') await applyAnswers(panel);
      } catch (error) {
        if (action === 'load-review-sets') {
          requiredElement(panel, '[data-review-count]').textContent = '加载失败，请重试';
        }
        setStatus(panel, '操作未完成');
        setLog(panel, errorMessage(error, '执行过程中发生错误。'), 'error');
      }
    });
  }

  async function open(
    extractedQuestions?: PintiaQuestionBankResult,
    automatic = false
  ): Promise<HTMLElement | null> {
    if (automatic && state.dismissedPageUrl === location.href) return null;
    if (!automatic) state.dismissedPageUrl = null;
    await state.panelStateReady;
    const existingPanel = document.getElementById('pintia-assistant-panel');
    const panel = existingPanel || createPanel(extractedQuestions);
    if (existingPanel && extractedQuestions) await loadQuestions(panel, extractedQuestions);
    panel.hidden = false;
    return panel;
  }

export const assistantPanel: PintiaAssistantApi = {
    open,
    showExtractionProgress,
    canAutoOpen() {
      return state.dismissedPageUrl !== location.href;
    },
    hide() {
      const panel = document.getElementById('pintia-assistant-panel');
      if (panel) panel.hidden = true;
    },
    clearCurrentProblemSet() {
      const panel = document.getElementById('pintia-assistant-panel');
      if (!panel) return;
      panel.querySelectorAll('[data-current-problem-set]').forEach((label) => label.remove());
      state.reviewProblemSets = state.reviewProblemSets?.filter((set) => !set.isCurrentOnly) || [];
      state.problemSetId = null;
      requiredElement(panel, '[data-review-count]').textContent = state.reviewProblemSets?.length
        ? `已加载 ${state.reviewProblemSets.length} 套题目集`
        : '尚未加载题目集';
      reviewExportPanel.updateReviewDelayVisibility(panel);
      requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-sets"]').disabled =
        !state.reviewProblemSets?.some((set) => set.examId);
    },
    async refreshQuestions(extractedQuestions) {
      const panel = document.getElementById('pintia-assistant-panel');
      if (panel) await loadQuestions(panel, extractedQuestions);
    },
    isVisible() {
      const panel = document.getElementById('pintia-assistant-panel');
      return Boolean(panel && !panel.hidden);
    }
  };
