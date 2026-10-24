(() => {
  const api = window.PintiaExtractor = window.PintiaExtractor || {};
  const API_HINTS = ['exam-problem-list', 'exam-problems', 'problem-summaries', 'exams'];
  let lastFailureReason = null;
  const problemSetMetadataCache = new Map();

  function readVarint(bytes, offset) {
    let value = 0;
    let shift = 0;
    while (offset < bytes.length && shift < 64) {
      const byte = bytes[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return { value, offset };
      shift += 7;
    }
    return null;
  }

  function protobufStrings(bytes) {
    const strings = [];
    let offset = 0;
    while (offset < bytes.length) {
      const key = readVarint(bytes, offset);
      if (!key) break;
      offset = key.offset;
      const wireType = key.value % 8;
      if (wireType === 0) {
        const value = readVarint(bytes, offset);
        if (!value) break;
        offset = value.offset;
      } else if (wireType === 1) offset += 8;
      else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        if (!length || length.value > bytes.length - length.offset) break;
        offset = length.offset;
        const end = offset + length.value;
        const chunk = bytes.slice(offset, end);
        const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk).replace(/\u0000/g, '').trim();
        if (text && !/[\ufffd]/.test(text) && !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text) && /[\p{L}\p{N}]/u.test(text)) strings.push(text);
        if (chunk.length > 1) strings.push(...protobufStrings(chunk));
        offset = end;
      } else if (wireType === 5) offset += 4;
      else break;
    }
    return strings;
  }

  function extractProtobufQuestions(bytes) {
    const strings = protobufStrings(bytes);
    const types = new Set([
      'MULTIPLE_CHOICE',
      'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
      'SINGLE_CHOICE',
      'TRUE_FALSE',
      'TRUE_OR_FALSE',
      'FILL_IN_THE_BLANK',
      'FILL_IN_THE_BLANK_FOR_PROGRAMMING',
      'CODE_COMPLETION',
      'PROGRAMMING',
      'SQL_PROGRAMMING',
      'SUBJECTIVE',
      'MULTIPLE_FILE',
      'SCRATCH',
      'CHOICE_BLANK',
      'NO_PROBLEM_TYPE'
    ]);
    const records = [];
    let current = [];
    strings.forEach((value) => {
      if (types.has(value) && current.length) {
        records.push(current);
        current = [];
      }
      current.push(value);
    });
    if (current.length) records.push(current);
    return api.uniqueQuestions(records.map((record, index) => {
      const type = record.find((value) => types.has(value));
      if (!type) return null;
      const candidates = record.filter((value) => !types.has(value) && value.length >= 2);
      const content = candidates.sort((left, right) => right.length - left.length)[0] || '';
      const optionLines = content.match(/(?:^|\n)\s*[A-Z][.、)]\s*[^\n]+/g) || [];
      const options = optionLines.map((line) => line.replace(/^\s*[A-Z][.、)]\s*/, '').trim());
      const prompt = content.replace(/\n\s*[A-Z][.、)]\s*[^\n]+/g, '').trim() || candidates[0];
      return api.normalizeApiQuestion({ type, title: prompt, problemConfig: { multipleChoiceProblemConfig: { choices: options } } }, index);
    }).filter(Boolean));
  }

  async function responseData(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) return { data: await response.json(), binary: null };
    const binary = new Uint8Array(await response.arrayBuffer());
    try { return { data: JSON.parse(new TextDecoder().decode(binary)), binary: null }; }
    catch (_) { return { data: null, binary }; }
  }

  function apiUrls() {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === location.origin && parsed.pathname.startsWith('/api/') && API_HINTS.some((hint) => parsed.pathname.includes(`/${hint}`));
      } catch (_) { return false; }
    });
    return [...new Set(urls)];
  }

  function isExamProblemListUrl(url) {
    return new URL(url).pathname.endsWith('/exam-problem-list');
  }

  function isExamProblemCollectionUrl(url) {
    return new URL(url).pathname.endsWith('/exam-problems');
  }

  function isExamProblemDetailUrl(url) {
    return /\/exam-problems\/[^/]+$/.test(new URL(url).pathname);
  }

  function problemSetIdFromUrl(url) {
    return new URL(url).pathname.match(/\/problem-sets\/([^/]+)/)?.[1] || null;
  }

  function currentProblemSetPage() {
    const match = location.pathname.match(/^\/problem-sets\/([^/]+)\/exam\/(?:overview|problems\/type\/[^/]+)\/?$/);
    return match ? { id: match[1], path: location.pathname } : null;
  }

  function currentProblemSetId() {
    return currentProblemSetPage()?.id || null;
  }

  api.currentProblemSetPage = currentProblemSetPage;

  async function problemSetMetadata(problemSetId) {
    if (problemSetMetadataCache.has(problemSetId)) return problemSetMetadataCache.get(problemSetId);
    const metadataPromise = (async () => {
      const url = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exams`, location.origin);
      const response = requiredResponse(await fetchResponse(url.href), '题集考试信息');
      const result = await responseData(response);
      const data = result.data?.data || result.data || {};
      return {
        name: data.problemSet?.name || null,
        examId: data.exam?.id ? String(data.exam.id) : null
      };
    })();
    problemSetMetadataCache.set(problemSetId, metadataPromise);
    try {
      const metadata = await metadataPromise;
      problemSetMetadataCache.set(problemSetId, metadata);
      return metadata;
    } catch (error) {
      problemSetMetadataCache.delete(problemSetId);
      throw error;
    }
  }

  async function fetchResponse(url, requestDelayMs = 0) {
    if (requestDelayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, requestDelayMs));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { accept: 'application/json, */*' } });
        if (response.ok) return response;
        if (response.status === 401 || response.status === 403) lastFailureReason = 'auth';
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    return null;
  }

  function questionPayload(result) {
    return result.binary ? extractProtobufQuestions(result.binary) : api.problemSetProblems(result.data);
  }

  function paginationInfo(data, count) {
    const source = data?.data || data || {};
    const total = Number(source.total || source.totalCount || source.pagination?.total || 0);
    const pageSize = Number(source.pageSize || source.page_size || source.limit || source.pagination?.pageSize || count);
    return { total, pageSize };
  }

  async function fetchExamUrl(url, expectedTotal = 0, requestDelayMs = 0) {
    const first = await fetchResponse(url, requestDelayMs);
    if (!first) return [];
    const firstResult = await responseData(first);
    const requestedType = new URL(url).searchParams.get('problem_type');
    const applyRequestedType = (question) => question.type === 'NO_PROBLEM_TYPE' && requestedType
      ? { ...question, type: api.normalizeType(requestedType, question.options) }
      : question;
    const firstQuestions = questionPayload(firstResult).map(applyRequestedType);
    const questions = [...firstQuestions];
    const { total, pageSize } = paginationInfo(firstResult.data, firstQuestions.length);
    const pages = Math.max(total, expectedTotal) > firstQuestions.length && pageSize > 0
      ? Math.ceil(Math.max(total, expectedTotal) / pageSize) : 1;
    for (let page = 2; page <= pages; page += 1) {
      const parsed = new URL(url);
      parsed.searchParams.set('page', String(page));
      parsed.searchParams.set('page_size', String(pageSize));
      const response = await fetchResponse(parsed.toString(), requestDelayMs);
      if (!response) break;
      const result = await responseData(response);
      const pageQuestions = questionPayload(result).map(applyRequestedType);
      if (!pageQuestions.length) break;
      questions.push(...pageQuestions);
    }
    return questions;
  }

  function listData(result) {
    const source = result.data?.data || result.data;
    return {
      problems: Array.isArray(source?.problemSetProblems) ? source.problemSetProblems : [],
      total: Number(source?.total || source?.totalCount || 0),
      examLabelByProblemSetProblemId: source?.examLabelByProblemSetProblemId || {}
    };
  }

  async function fetchExamProblemList(url, requestDelayMs = 0) {
    const first = await fetchResponse(url, requestDelayMs);
    if (!first) return { problems: [], examLabelByProblemSetProblemId: {} };
    const firstResult = await responseData(first);
    const firstPage = listData(firstResult);
    const problems = [...firstPage.problems];
    const examLabelByProblemSetProblemId = { ...firstPage.examLabelByProblemSetProblemId };
    const parsed = new URL(url);
    const pageParameter = parsed.searchParams.has('page') ? 'page' : null;
    const pageSizeParameter = parsed.searchParams.has('limit') ? 'limit' : 'page_size';
    const pageSize = Number(parsed.searchParams.get(pageSizeParameter)) || firstPage.problems.length;
    const firstPageNumber = Number(parsed.searchParams.get(pageParameter || 'page')) || 0;
    const pageCount = pageSize > 0 ? Math.ceil(firstPage.total / pageSize) : 1;
    for (let offset = 1; offset < pageCount; offset += 1) {
      parsed.searchParams.set(pageParameter || 'page', String(firstPageNumber + offset));
      const response = await fetchResponse(parsed.toString(), requestDelayMs);
      if (!response) break;
      const result = await responseData(response);
      const page = listData(result);
      if (!page.problems.length) break;
      problems.push(...page.problems);
      Object.assign(examLabelByProblemSetProblemId, page.examLabelByProblemSetProblemId);
    }
    return { problems, examLabelByProblemSetProblemId };
  }

  function problemDetailUrl(listUrl, problemId, problemType) {
    const parsed = new URL(listUrl);
    parsed.pathname = parsed.pathname.replace(/\/exam-problem-list$/, `/exam-problems/${encodeURIComponent(problemId)}`);
    parsed.searchParams.delete('page');
    parsed.searchParams.delete('limit');
    parsed.searchParams.delete('page_size');
    if (parsed.pathname.startsWith('/api/problem-sets/')) {
      parsed.searchParams.delete('exam_id');
      parsed.searchParams.delete('problem_type');
    } else if (problemType) {
      parsed.searchParams.set('problem_type', problemType);
    }
    return parsed.toString();
  }

  function normalizeProblemDetail(data, listedProblem, examLabel, problemType) {
    const problem = data?.problemSetProblem || data?.data?.problemSetProblem || data;
    if (!problem || typeof problem !== 'object') return null;
    const normalized = api.normalizeApiQuestion({
      ...problem,
      type: problem.type || problem.problem_type || problem.problemType || problem.question_type || problemType,
      id: problem.id || listedProblem?.id,
      number: listedProblem?.problemPoolIndex ?? listedProblem?.indexInProblemPool ?? problem.problemPoolIndex,
      score: problem.score ?? listedProblem?.score
    }, listedProblem?.problemPoolIndex ?? 0);
    if (!normalized) return null;
    return {
      ...normalized,
      apiData: {
        ...normalized.apiData,
        examLabel: examLabel || undefined
      }
    };
  }

  async function fetchListedQuestions(listUrl, list, requestDelayMs = 0) {
    const labelById = list.examLabelByProblemSetProblemId || {};
    const problemType = new URL(listUrl).searchParams.get('problem_type');
    const questions = [];
    for (const listedProblem of list.problems) {
      if (!listedProblem?.id) continue;
      let question = null;
      try {
        const listedType = listedProblem.type || listedProblem.problem_type || problemType || 'NO_PROBLEM_TYPE';
        const response = await fetchResponse(problemDetailUrl(listUrl, listedProblem.id, listedType), requestDelayMs);
        if (response) question = normalizeProblemDetail(await responseData(response), listedProblem, labelById[listedProblem.id], listedType);
      } catch (error) {
        console.warn(`题目详情读取失败（${listedProblem.id}）：`, error);
      }
      if (!question) {
        question = api.normalizeApiQuestion({
          ...listedProblem,
          type: listedProblem.type || listedProblem.problem_type || problemType || 'NO_PROBLEM_TYPE',
          number: listedProblem.problemPoolIndex ?? listedProblem.indexInProblemPool
        }, listedProblem.problemPoolIndex ?? 0);
      }
      if (question) questions.push(question);
    }
    return questions;
  }

  function isListBackedProblemType(type) {
    return type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING'
      || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING' || type === 'SUBJECTIVE';
  }

  function typedUrl(url, type) {
    if (!url) return null;
    const parsed = new URL(url, location.origin);
    parsed.searchParams.delete('problemType');
    parsed.searchParams.delete('type');
    parsed.searchParams.set('problem_type', type);
    return parsed.href;
  }

  function problemListUrl(collectionUrl, observedListUrl, type) {
    if (observedListUrl) return typedUrl(observedListUrl, type);
    if (!collectionUrl) return null;
    const parsed = new URL(collectionUrl, location.origin);
    if (!parsed.pathname.startsWith('/api/exams/') || !parsed.pathname.endsWith('/exam-problems')) return null;
    parsed.pathname = parsed.pathname.replace(/\/exam-problems$/, '/exam-problem-list');
    return typedUrl(parsed.href, type);
  }

  function problemSetListUrl(problemSetId, examId, type) {
    if (!problemSetId || !examId) return null;
    const url = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exam-problem-list`, location.origin);
    url.searchParams.set('exam_id', examId);
    url.searchParams.set('problem_type', type);
    return url.href;
  }

  function withExamId(url, examId) {
    if (!url || !examId) return url;
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set('exam_id', examId);
    return parsed.href;
  }

  async function fetchQuestionsForType(type, options = {}) {
    const requestDelayMs = options.requestDelayMs || 0;
    if (isListBackedProblemType(type)) {
      const listUrl = withExamId(problemListUrl(options.collectionUrl, options.listUrl, type), options.examId);
      if (!listUrl) return [];
      const list = await fetchExamProblemList(listUrl, requestDelayMs);
      return fetchListedQuestions(listUrl, list, requestDelayMs);
    }
    const collectionUrl = withExamId(typedUrl(options.collectionUrl, type), options.examId);
    if (!collectionUrl) return [];
    return fetchExamUrl(collectionUrl, options.expectedTotal || 0, requestDelayMs);
  }

  function requiredResponse(response, label) {
    if (!response) throw new Error(`${label}读取失败，请确认已登录且有权访问该作业。`);
    return response;
  }

  function extractSubmissionAnswer(detail) {
    if (!detail || typeof detail !== 'object') return undefined;
    const preferredKeys = ['answer', 'answers', 'code', 'sourceCode', 'submittedCode', 'content'];
    for (const key of preferredKeys) {
      if (detail[key] !== undefined && detail[key] !== null && detail[key] !== '') return detail[key];
    }
    for (const value of Object.values(detail)) {
      if (value && typeof value === 'object') {
        const answer = extractSubmissionAnswer(value);
        if (answer !== undefined) return answer;
      }
    }
    return undefined;
  }

  function evaluationOf(value) {
    const text = String(value || '').trim().toUpperCase();
    if (/答案正确|^(CORRECT|ACCEPTED|ANSWER_CORRECT|RIGHT|SUCCESS)$/.test(text)) return 'correct';
    if (/答案错误|^(WRONG|WRONG_ANSWER|INCORRECT|ANSWER_WRONG|REJECTED)$/.test(text)) return 'wrong';
    return null;
  }

  function submissionResults(data) {
    const submission = data?.submission || data?.data?.submission || data?.data || data || {};
    const byProblemId = new Map();
    for (const detail of submission.submissionDetails || []) {
      const problemId = String(detail.problemSetProblemId || detail.problemId || '');
      if (!problemId || problemId === '0') continue;
      const detailBody = Object.entries(detail).find(([key, value]) =>
        key.endsWith('SubmissionDetail') && value && typeof value === 'object')?.[1] || detail;
      byProblemId.set(problemId, {
        answer: extractSubmissionAnswer(detailBody),
        evaluation: null
      });
    }

    const inspectJudgments = (value, inheritedProblemId = '') => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((entry) => inspectJudgments(entry, inheritedProblemId));
        return;
      }
      const problemId = String(value.problemSetProblemId || value.problemId || inheritedProblemId);
      const statuses = Object.entries(value)
        .filter(([key]) => /status|result|judge|message|content/i.test(key))
        .map(([, entry]) => typeof entry === 'object' ? '' : String(entry || ''));
      const evaluation = statuses.map(evaluationOf).find(Boolean);
      if (problemId && byProblemId.has(problemId) && evaluation) {
        byProblemId.get(problemId).evaluation = evaluation;
      }
      Object.values(value).forEach((entry) => inspectJudgments(entry, problemId));
    };
    inspectJudgments(submission.judgeResponseContents);
    return byProblemId;
  }

  function reviewSubmissionUrl(examId, problemSetId, type) {
    const url = new URL(`/api/exams/${encodeURIComponent(examId)}/problem-sets/${encodeURIComponent(problemSetId)}/last-submissions`, location.origin);
    url.searchParams.set('problem_type', type);
    return url.href;
  }

  let reviewProblemSetsCache = null;
  let reviewProblemSetsPromise = null;
  api.listProblemSets = async (requestDelayMs = 0) => {
    if (reviewProblemSetsCache) return reviewProblemSetsCache;
    if (reviewProblemSetsPromise) return reviewProblemSetsPromise;
    reviewProblemSetsPromise = (async () => {
      const setsById = new Map();
      const examIds = {};
      let page = 0;
      let total = Infinity;
      while (setsById.size < total) {
        const url = new URL('/api/problem-sets', location.origin);
        url.searchParams.set('filter', '{}');
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', '30');
        url.searchParams.set('order_by', 'END_AT');
        url.searchParams.set('asc', 'false');
        const response = requiredResponse(await fetchResponse(url.href, requestDelayMs), '题目集列表');
        const result = await responseData(response);
        const data = result.data?.data || result.data || {};
        const sets = Array.isArray(data.problemSets) ? data.problemSets : [];
        if (!sets.length) break;
        sets.forEach((set) => setsById.set(String(set.id), set));
        Object.assign(examIds, data.examIdByProblemSetId || {});
        total = Number(data.total || setsById.size);
        page += 1;
      }
      return [...setsById.values()].map((set) => ({
        ...set,
        examId: examIds[set.id] ? String(examIds[set.id]) : null
      }));
    })();
    try {
      reviewProblemSetsCache = await reviewProblemSetsPromise;
      return reviewProblemSetsCache;
    } finally {
      reviewProblemSetsPromise = null;
    }
  };

  api.extractProblemSetForReview = async (problemSet, requestDelayMs = 0) => {
    const problemSetId = String(problemSet?.id || '');
    const examId = String(problemSet?.examId || '');
    if (!problemSetId || !examId) throw new Error('作业缺少考试 ID，无法读取题目及作答。');

    const summaryUrl = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/problem-summaries`, location.origin);
    const summaryResponse = requiredResponse(await fetchResponse(summaryUrl.href, requestDelayMs), '题型摘要');
    const summaryData = await responseData(summaryResponse);
    const summaries = summaryData.data?.summaries || summaryData.data?.data?.summaries || {};
    const types = Object.entries(summaries)
      .filter(([, summary]) => Number(summary?.total || 0) > 0)
      .map(([type]) => type);
    if (!types.length) throw new Error(`“${problemSet.name}”没有可导出的题型。`);

    const questions = [];
    const submissions = new Map();
    const collectionUrl = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exam-problems`, location.origin);
    collectionUrl.searchParams.set('exam_id', examId);
    for (const type of types) {
      const listUrl = isListBackedProblemType(type)
        ? new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exam-problem-list`, location.origin)
        : null;
      if (listUrl) {
        listUrl.searchParams.set('exam_id', examId);
        listUrl.searchParams.set('problem_type', type);
      }
      const typeQuestions = await fetchQuestionsForType(type, {
        collectionUrl: collectionUrl.href,
        listUrl: listUrl?.href || null,
        expectedTotal: Number(summaries[type]?.total || 0),
        requestDelayMs
      });
      if (!typeQuestions.length) {
        throw new Error(`${type}题目读取失败：接口未返回可导出的题目。`);
      }
      questions.push(...typeQuestions);

      const response = requiredResponse(
        await fetchResponse(reviewSubmissionUrl(examId, problemSetId, type), requestDelayMs),
        `${type}作答记录`
      );
      const result = await responseData(response);
      for (const [id, submission] of submissionResults(result.data || {}).entries()) {
        submissions.set(id, submission);
      }
    }

    const uniqueQuestions = api.uniqueQuestions(questions);
    return {
      title: problemSet.name || 'Pintia 作业',
      source: `${location.origin}/problem-sets/${encodeURIComponent(problemSetId)}`,
      questions: uniqueQuestions.map((question) => ({
        ...question,
        submission: submissions.get(String(question.id || '')) || null
      }))
    };
  };

  api.extractFromApi = async () => {
    lastFailureReason = null;
    const currentPage = currentProblemSetPage();
    if (!currentPage) {
      return { problemSetId: null, problemSetName: null, examId: null, questions: [], summaries: {}, reason: 'not_problem_set_exam_page' };
    }
    const observedUrls = apiUrls().filter((url) => problemSetIdFromUrl(url) === currentPage.id);
    const observedSummaryUrls = observedUrls.filter((url) => url.includes('/problem-summaries'));
    const examUrls = observedUrls.filter(isExamProblemCollectionUrl);
    const examProblemListUrls = observedUrls.filter(isExamProblemListUrl);
    const examDetailUrls = observedUrls.filter(isExamProblemDetailUrl);
    const problemSetId = currentPage.id
      || [...examProblemListUrls, ...examUrls, ...examDetailUrls, ...observedSummaryUrls].map(problemSetIdFromUrl).find(Boolean)
      || null;
    let metadata = { name: null, examId: null };
    if (problemSetId) {
      try {
        metadata = await problemSetMetadata(problemSetId);
      } catch (error) {
        console.warn('当前题集信息读取失败：', error);
      }
    }
    const examId = metadata.examId || observedUrls
      .filter((url) => problemSetIdFromUrl(url) === problemSetId)
      .map((url) => new URL(url).searchParams.get('exam_id'))
      .find(Boolean) || null;
    if (currentPage.path.endsWith('/overview')) {
      return {
        problemSetId,
        problemSetName: metadata.name,
        examId,
        questions: [],
        summaries: {},
        reason: 'overview_metadata_only'
      };
    }
    let summaries = {};
    const summaryUrls = observedSummaryUrls.length
      ? observedSummaryUrls
      : problemSetId
        ? [new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/problem-summaries`, location.origin).href]
        : [];
    for (const url of summaryUrls) {
      try {
        const response = await fetchResponse(url);
        if (!response) continue;
        const result = await responseData(response);
        summaries = result.data?.summaries || result.data?.data?.summaries || summaries;
        if (Object.keys(summaries).length) break;
      } catch (_) { /* The exam request can still be used. */ }
    }
    const examUrl = examUrls.find((url) => new URL(url).searchParams.has('problem_type')) || examUrls[0];
    const types = Object.keys(summaries).length
      ? Object.entries(summaries)
        .filter(([, summary]) => Number(summary?.total || 0) > 0)
        .map(([type]) => type)
      : [...examUrls, ...examProblemListUrls]
        .map((url) => new URL(url).searchParams.get('problem_type'))
        .filter(Boolean);
    const questions = [];
    const observedListUrl = examProblemListUrls.find((url) => new URL(url).searchParams.has('problem_type')) || examProblemListUrls[0];
    const fallbackExamUrl = examId
      ? new URL(`/api/exams/${encodeURIComponent(examId)}/problem-sets/${encodeURIComponent(problemSetId)}/exam-problems`, location.origin).href
      : null;
    for (const type of types) {
      const collectionUrl = examUrls.find((url) => new URL(url).searchParams.get('problem_type') === type)
        || examUrl
        || fallbackExamUrl;
      const listUrl = observedListUrl || (isListBackedProblemType(type)
        ? problemSetListUrl(problemSetId, examId, type)
        : null);
      try {
        questions.push(...await fetchQuestionsForType(type, {
          collectionUrl,
          listUrl,
          examId,
          expectedTotal: Number(summaries[type]?.total || 0)
        }));
      } catch (error) {
        console.warn(`${type}题目读取失败：`, error);
      }
    }
    for (const url of examDetailUrls) {
      try {
        const response = await fetchResponse(url);
        if (response) {
          const question = normalizeProblemDetail(
            await responseData(response),
            null,
            null,
            new URL(url).searchParams.get('problem_type') || 'NO_PROBLEM_TYPE'
          );
          if (question) questions.push(question);
        }
      } catch (error) {
        console.warn('当前题目详情读取失败：', error);
      }
    }
    const uniqueQuestions = api.uniqueQuestions(questions);
    return {
      problemSetId,
      problemSetName: metadata.name,
      examId,
      questions: uniqueQuestions,
      summaries,
      reason: uniqueQuestions.length ? null : (lastFailureReason || 'no_questions')
    };
  };
})();