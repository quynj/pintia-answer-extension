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
    if (message.type === 'open-assistant') {
      window.PintiaAssistant.open();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type !== 'inspect' && message.type !== 'export') return false;
    extract(message.type === 'inspect')
      .then((result) => message.type === 'inspect'
        ? sendResponse({
          questionCount: result.questions.length,
          questionTypes: [...new Set(result.questions.map((question) => question.type))],
          extraction: result.extraction,
          reason: result.reason
        })
        : sendResponse(result))
      .catch((error) => sendResponse({ error: error?.message || '题库接口读取失败' }));
    return true;
  });
})();
