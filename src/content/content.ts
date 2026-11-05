import { pintiaExtractor as api } from './extraction/api-extractor';
import { assistantPanel } from './assistant/assistant-panel';
import type { PintiaQuestionBankResult } from '../shared/types';

  let cachedResult: PintiaQuestionBankResult | null = null;
  let cachedSource: string | null = null;
  let extractionPromise: Promise<PintiaQuestionBankResult> | null = null;
  let extractionPromiseSource: string | null = null;

  function errorMessage(error: unknown, fallback = '发生未知错误。'): string {
    return error instanceof Error ? error.message : fallback;
  }

  async function problemDetailRequestDelay() {
    const { problemDetailRequestDelayMs } = await chrome.storage.local.get('problemDetailRequestDelayMs');
    return Number.isInteger(problemDetailRequestDelayMs)
      && problemDetailRequestDelayMs >= 0
      && problemDetailRequestDelayMs <= 10000
      ? problemDetailRequestDelayMs : 1000;
  }

  function title() {
    const heading = document.querySelector('h1, h2, [class*="title"], [class*="Title"]');
    return api.cleanText(heading?.textContent) || api.cleanText(document.title).replace(/[-|].*$/, '') || 'pintia-question-bank';
  }

  async function extract(
    forceRefresh = false,
    onProgress?: (progress: Record<string, unknown>) => void,
    streamQuestions = false
  ): Promise<PintiaQuestionBankResult> {
    const source = location.href;
    if (!forceRefresh && cachedResult && cachedSource === source) return cachedResult;
    if (!forceRefresh && extractionPromise && extractionPromiseSource === source) return extractionPromise;

    const pendingExtraction = (async () => {
      const apiResult = await api.extractFromApi({
        detailRequestDelayMs: await problemDetailRequestDelay(),
        onProgress,
        forceRefresh,
        onQuestion: streamQuestions
          ? (question, problemSetId) => {
            if (location.href === source) assistantPanel.appendQuestions([question], problemSetId);
          }
          : undefined
      });
      const result = {
        title: apiResult.problemSetName || title(),
        source,
        extraction: 'api',
        problemSetId: apiResult.problemSetId,
        problemSetName: apiResult.problemSetName,
        examId: apiResult.examId,
        summaries: apiResult.summaries,
        reason: apiResult.reason,
        exportedAt: new Date().toISOString(),
        questions: apiResult.questions
      };
      if (result.questions.length && location.href === source) {
        cachedResult = result;
        cachedSource = source;
      }
      return result;
    })();
    extractionPromise = pendingExtraction;
    extractionPromiseSource = source;

    try {
      return await pendingExtraction;
    } finally {
      if (extractionPromise === pendingExtraction) {
        extractionPromise = null;
        extractionPromiseSource = null;
      }
    }
  }

  function reportExtractionProgress(progress: Record<string, unknown>): void {
    assistantPanel.showExtractionProgress(progress);
  }

  async function assistantAutoOpenEnabled() {
    const { assistantAutoOpenEnabled: enabled } = await chrome.storage.local.get('assistantAutoOpenEnabled');
    return enabled !== false;
  }

  async function showAssistantManually() {
    await assistantPanel.open();
    if (!api.currentProblemSetPage()) return;
    assistantPanel.showExtractionProgress({ phase: 'starting' });
    extract(false, reportExtractionProgress, true)
      .then((result) => {
        if (assistantPanel.isVisible()) return assistantPanel.open(result);
      })
      .catch((error: unknown) => {
        assistantPanel.showExtractionProgress({ phase: 'error', message: errorMessage(error) });
      });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'toggle-assistant') {
      const toggleAssistant = async () => {
        if (await assistantAutoOpenEnabled()) {
          await chrome.storage.local.set({ assistantAutoOpenEnabled: false });
          assistantPanel.hide();
          return { visible: false, mode: 'hidden' };
        }
        await chrome.storage.local.set({ assistantAutoOpenEnabled: true });
        await showAssistantManually();
        return { visible: true, mode: 'automatic' };
      };
      toggleAssistant()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ error: errorMessage(error, '无法切换答案助手。') }));
      return true;
    }
    if (message.type === 'assistant-state') {
      sendResponse({ visible: assistantPanel.isVisible() });
      return false;
    }
    if (message.type === 'list-review-problem-sets') {
      api.listProblemSets()
        .then((problemSets) => sendResponse({ problemSets }))
        .catch((error) => sendResponse({ error: errorMessage(error, '题目集列表读取失败。') }));
      return true;
    }
    if (message.type === 'export-review-problem-set') {
      api.extractProblemSetForReview(
        message.problemSet,
        message.detailRequestDelayMs,
        message.includeSubmissions !== false
      )
        .then((result) => sendResponse({ result }))
        .catch((error) => sendResponse({ error: errorMessage(error, '题目集导出失败。') }));
      return true;
    }
    if (message.type !== 'inspect' && message.type !== 'export') return false;
    const extraction = (async () => {
      if (message.type === 'inspect') await assistantPanel.open();
      if (assistantPanel.isVisible()) {
        assistantPanel.showExtractionProgress({ phase: 'starting' });
      }
      return extract(message.type === 'inspect', reportExtractionProgress, message.type === 'inspect');
    })();
    extraction
      .then(async (result) => {
        if (message.type === 'inspect') {
          await assistantPanel.refreshQuestions(result);
          return {
            questionCount: result.questions.length,
            questionTypes: [...new Set(result.questions.map((question) => question.type))],
            extraction: result.extraction,
            reason: result.reason
          };
        }
        return result;
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error, '题库接口读取失败') }));
    return true;
  });

  let autoDetectionTimer: ReturnType<typeof setTimeout> | undefined;
  const autoDetectedQuestionSets = new Set();
  let autoDetectionInProgress = false;
  let pendingQuestionSetId: string | null = null;

  function scheduleAutomaticDetection(requestedSetId: string | null = null) {
    if (!api.currentProblemSetPage()) {
      window.clearTimeout(autoDetectionTimer);
      pendingQuestionSetId = null;
      assistantPanel.clearCurrentProblemSet();
      assistantAutoOpenEnabled().then((enabled) => {
        if (enabled && assistantPanel.canAutoOpen()) assistantPanel.open(undefined, true)
          .catch((error) => console.error('打开助手面板失败：', error));
      }).catch((error) => console.error('读取助手自动显示设置失败：', error));
      return;
    }
    if (requestedSetId && autoDetectedQuestionSets.has(requestedSetId)) return;
    if (autoDetectionInProgress) {
      pendingQuestionSetId = requestedSetId || pendingQuestionSetId;
      return;
    }
    window.clearTimeout(autoDetectionTimer);
    autoDetectionTimer = window.setTimeout(async () => {
      if (autoDetectionInProgress) return;
      const detectedLocation = location.href;
      autoDetectionInProgress = true;
      try {
        if (await assistantAutoOpenEnabled()) {
          await assistantPanel.open(undefined, true);
          assistantPanel.showExtractionProgress({ phase: 'starting' });
        }
        const result = await extract(false, (progress: Record<string, unknown>) => {
          assistantPanel.showExtractionProgress(progress);
        }, true);
        if (location.href !== detectedLocation) return;
        if (!result.questions.length) {
          if (await assistantAutoOpenEnabled()) await assistantPanel.open(result, true);
          return;
        }
        if (requestedSetId) autoDetectedQuestionSets.add(requestedSetId);
        if (result.problemSetId) autoDetectedQuestionSets.add(result.problemSetId);
        await chrome.storage.local.set({
          lastDetection: {
            source: detectedLocation,
            questionCount: result.questions.length,
            questionTypes: [...new Set(result.questions.map((question) => question.type))],
            detectedAt: new Date().toISOString()
          }
        });
        if (await assistantAutoOpenEnabled()) await assistantPanel.open(result, true);
      } catch (error) {
        if (await assistantAutoOpenEnabled()) {
          assistantPanel.showExtractionProgress({ phase: 'error', message: errorMessage(error) });
        }
        console.error('自动检测题集失败：', error);
      } finally {
        autoDetectionInProgress = false;
        const pendingSetId = pendingQuestionSetId;
        pendingQuestionSetId = null;
        if (pendingSetId && !autoDetectedQuestionSets.has(pendingSetId)) {
          scheduleAutomaticDetection(pendingSetId);
        }
      }
    }, 350);
  }

  function isQuestionApiRequest(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.origin === location.origin
        && parsed.pathname.startsWith('/api/')
        && (parsed.pathname.includes('/exam-problem-list')
          || parsed.pathname.includes('/exam-problems')
          || parsed.pathname.includes('/problem-summaries')
          || /^\/api\/problem-sets\/[^/]+\/exams$/.test(parsed.pathname));
    } catch (_) {
      return false;
    }
  }

  function handlePageLocationChange() {
    scheduleAutomaticDetection();
  }

  function questionSetIdFromRequest(url: string): string | null {
    try {
      return new URL(url).pathname.match(/\/problem-sets\/([^/]+)/)?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  if (typeof PerformanceObserver !== 'undefined') {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isQuestionApiRequest(entry.name)) continue;
        scheduleAutomaticDetection(questionSetIdFromRequest(entry.name));
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  }
  window.addEventListener('popstate', handlePageLocationChange);
  window.addEventListener('hashchange', handlePageLocationChange);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local'
      && changes.assistantAutoOpenEnabled?.newValue === false) {
      assistantPanel.hide();
    }
  });
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = ((...args: [data: unknown, unused: string, url?: string | URL | null]) => {
      const result = original(...args);
      handlePageLocationChange();
      return result;
    }) as typeof history[typeof method];
  }
  scheduleAutomaticDetection();
