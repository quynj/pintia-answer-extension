(() => {
  const api = window.PintiaExtractor = window.PintiaExtractor || {};
  const API_HINTS = ['exam-problem-list', 'exam-problems', 'problem-summaries'];
  let lastFailureReason = null;

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
      'PROGRAMMING',
      'SHORT_ANSWER'
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

  async function fetchResponse(url) {
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

  async function fetchExamUrl(url, expectedTotal = 0) {
    const first = await fetchResponse(url);
    if (!first) return [];
    const firstResult = await responseData(first);
    const firstQuestions = questionPayload(firstResult);
    const questions = [...firstQuestions];
    const { total, pageSize } = paginationInfo(firstResult.data, firstQuestions.length);
    const pages = Math.max(total, expectedTotal) > firstQuestions.length && pageSize > 0
      ? Math.ceil(Math.max(total, expectedTotal) / pageSize) : 1;
    for (let page = 2; page <= pages; page += 1) {
      const parsed = new URL(url);
      parsed.searchParams.set('page', String(page));
      parsed.searchParams.set('page_size', String(pageSize));
      const response = await fetchResponse(parsed.toString());
      if (!response) break;
      const result = await responseData(response);
      const pageQuestions = questionPayload(result);
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

  async function fetchExamProblemList(url) {
    const first = await fetchResponse(url);
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
      const response = await fetchResponse(parsed.toString());
      if (!response) break;
      const result = await responseData(response);
      const page = listData(result);
      if (!page.problems.length) break;
      problems.push(...page.problems);
      Object.assign(examLabelByProblemSetProblemId, page.examLabelByProblemSetProblemId);
    }
    return { problems, examLabelByProblemSetProblemId };
  }

  function programmingDetailUrl(listUrl, problemId) {
    const parsed = new URL(listUrl);
    parsed.pathname = parsed.pathname.replace(/\/exam-problem-list$/, `/exam-problems/${encodeURIComponent(problemId)}`);
    parsed.searchParams.delete('page');
    parsed.searchParams.delete('limit');
    parsed.searchParams.delete('page_size');
    parsed.searchParams.set('problem_type', 'PROGRAMMING');
    return parsed.toString();
  }

  function normalizeProgrammingDetail(data, listedProblem, examLabel) {
    const problem = data?.problemSetProblem || data?.data?.problemSetProblem || data;
    if (!problem || typeof problem !== 'object') return null;
    const normalized = api.normalizeApiQuestion({
      ...problem,
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

  async function fetchProgrammingQuestions(listUrl, list) {
    const labelById = list.examLabelByProblemSetProblemId || {};
    const questions = [];
    for (const listedProblem of list.problems) {
      if (!listedProblem?.id) continue;
      let question = null;
      try {
        const response = await fetchResponse(programmingDetailUrl(listUrl, listedProblem.id));
        if (response) question = normalizeProgrammingDetail(await responseData(response), listedProblem, labelById[listedProblem.id]);
      } catch (error) {
        console.warn(`编程题详情读取失败（${listedProblem.id}）：`, error);
      }
      if (!question) {
        question = api.normalizeApiQuestion({
          ...listedProblem,
          number: listedProblem.problemPoolIndex ?? listedProblem.indexInProblemPool
        }, listedProblem.problemPoolIndex ?? 0);
      }
      if (question) questions.push(question);
    }
    return questions;
  }

  api.extractFromApi = async () => {
    lastFailureReason = null;
    const observedUrls = apiUrls();
    const summaryUrls = observedUrls.filter((url) => url.includes('/problem-summaries'));
    const examUrls = observedUrls.filter(isExamProblemCollectionUrl);
    const examProblemListUrls = observedUrls.filter(isExamProblemListUrl);
    const examDetailUrls = observedUrls.filter(isExamProblemDetailUrl);
    const problemSetId = [...examProblemListUrls, ...examUrls, ...examDetailUrls, ...summaryUrls].map(problemSetIdFromUrl).find(Boolean) || null;
    if (!summaryUrls.length && !examUrls.length && !examProblemListUrls.length && !examDetailUrls.length) {
      return { problemSetId, questions: [], summaries: {}, reason: 'no_target_api' };
    }
    let summaries = {};
    for (const url of summaryUrls) {
      try {
        const response = await fetchResponse(url);
        if (!response) continue;
        const result = await responseData(response);
        summaries = result.data?.summaries || summaries;
        if (Object.keys(summaries).length) break;
      } catch (_) { /* The exam request can still be used. */ }
    }
    const examUrl = examUrls.find((url) => new URL(url).searchParams.has('problem_type')) || examUrls[0];
    const urls = new Map();
    Object.keys(summaries).forEach((problemType) => {
      if (!examUrl) return;
      const parsed = new URL(examUrl);
      parsed.searchParams.delete('problemType');
      parsed.searchParams.delete('type');
      parsed.searchParams.set('problem_type', problemType);
      urls.set(parsed.toString(), problemType);
    });
    const questions = [];
    for (const [url, type] of urls) {
      const expectedTotal = summaries[type]?.total || 0;
      try { questions.push(...await fetchExamUrl(url, Number(expectedTotal))); } catch (_) { /* Try remaining variants. */ }
    }
    const programmingQuestions = [];
    for (const url of examProblemListUrls) {
      try {
        const list = await fetchExamProblemList(url);
        programmingQuestions.push(...await fetchProgrammingQuestions(url, list));
      } catch (error) {
        console.warn('编程题列表读取失败：', error);
      }
    }
    for (const url of examDetailUrls) {
      try {
        const response = await fetchResponse(url);
        if (response) {
          const question = normalizeProgrammingDetail(await responseData(response), null, null);
          if (question) programmingQuestions.push(question);
        }
      } catch (error) {
        console.warn('当前编程题详情读取失败：', error);
      }
    }
    const uniqueQuestions = api.uniqueQuestions([...programmingQuestions, ...questions]);
    return {
      problemSetId,
      questions: uniqueQuestions,
      summaries,
      reason: uniqueQuestions.length ? null : (lastFailureReason || 'no_questions')
    };
  };
})();