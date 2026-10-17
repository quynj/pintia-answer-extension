(() => {
  const api = window.PintiaExtractor;
  let cachedResult = null;
  let extractionPromise = null;

  function title() {
    const heading = document.querySelector('h1, h2, [class*="title"], [class*="Title"]');
    return api.cleanText(heading?.textContent) || api.cleanText(document.title).replace(/[-|].*$/, '') || 'pintia-question-bank';
  }

  async function extract(forceRefresh = false) {
    if (!forceRefresh && cachedResult) return cachedResult;
    if (!forceRefresh && extractionPromise) return extractionPromise;

    extractionPromise = (async () => {
    const apiResult = await api.extractFromApi();
      const result = {
        title: title(),
        source: location.href,
        extraction: 'api',
        summaries: apiResult.summaries,
        reason: apiResult.reason,
        exportedAt: new Date().toISOString(),
        questions: apiResult.questions
      };
      cachedResult = result;
      return result;
    })();

    try {
      return await extractionPromise;
    } finally {
      extractionPromise = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'toggle-assistant') {
      window.PintiaAssistant.toggle()
        .then((visible) => sendResponse({ ok: true, visible }))
        .catch((error) => sendResponse({ error: error?.message || '无法切换答案助手。' }));
      return true;
    }
    if (message.type === 'assistant-state') {
      sendResponse({ visible: window.PintiaAssistant.isVisible() });
      return false;
    }
    if (message.type !== 'inspect' && message.type !== 'export') return false;
    extract(message.type === 'inspect')
      .then(async (result) => {
        if (message.type === 'inspect') {
          await window.PintiaAssistant.refreshQuestions(result);
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
      .catch((error) => sendResponse({ error: error?.message || '题库接口读取失败' }));
    return true;
  });

  let autoDetectionTimer;
  const autoDetectedQuestionSets = new Set();
  let autoDetectionInProgress = false;
  let pendingQuestionSetId = null;

  function scheduleAutomaticDetection(requestedSetId = null) {
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
        const result = await api.extractFromApi();
        if (!result.questions.length || location.href !== detectedLocation) return;
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
        await window.PintiaAssistant.open(result);
      } catch (error) {
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

  function isQuestionApiRequest(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === location.origin
        && parsed.pathname.startsWith('/api/')
        && (parsed.pathname.includes('/exam-problem-list')
          || parsed.pathname.includes('/exam-problems')
          || parsed.pathname.includes('/problem-summaries'));
    } catch (_) {
      return false;
    }
  }

  function questionSetIdFromRequest(url) {
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
  scheduleAutomaticDetection();
})();
