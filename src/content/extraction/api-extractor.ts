import { extractorApi as commonApi } from './extractor-common';
import { submissionResults } from './review-submissions';
import type { PintiaExtractOptions, PintiaExtractorApi, PintiaProblemSet, PintiaQuestion } from '../../shared/types';
type ApiObject = Record<string, unknown>;
type ResponseData = { data: unknown; binary: Uint8Array | null };
type ProblemList = {
  problems: ApiObject[];
  total?: number;
  examLabelByProblemSetProblemId: Record<string, string>;
};
type FetchQuestionOptions = {
  collectionUrl?: string | null;
  listUrl?: string | null;
  examId?: string | null;
  expectedTotal?: number;
  detailRequestDelayMs?: number;
  requestDelayMs?: number;
  forceRefresh?: boolean;
  onQuestion?: (question: PintiaQuestion) => void;
  onProgress?: ((progress: Record<string, unknown>) => void) | null;
  typeProgress?: Record<string, unknown>;
};
  const API_HINTS = ['exam-problem-list', 'exam-problems', 'problem-summaries', 'exams'];
  let lastFailureReason: string | null = null;
  const problemSetMetadataCache = new Map<string, { name: string | null; examId: string | null } | Promise<{ name: string | null; examId: string | null }>>();

  function isRecord(value: unknown): value is ApiObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function asRecord(value: unknown): ApiObject {
    return isRecord(value) ? value : {};
  }

  function isPintiaQuestion(value: unknown): value is PintiaQuestion {
    return isRecord(value) && typeof value.type === 'string';
  }

  function readVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } | null {
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

  function protobufStrings(bytes: Uint8Array): string[] {
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

  function extractProtobufQuestions(bytes: Uint8Array): PintiaQuestion[] {
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
    const records: string[][] = [];
    let current: string[] = [];
    strings.forEach((value: string) => {
      if (types.has(value) && current.length) {
        records.push(current);
        current = [];
      }
      current.push(value);
    });
    if (current.length) records.push(current);
    return commonApi.uniqueQuestions(records.map((record, index) => {
      const type = record.find((value) => types.has(value));
      if (!type) return null;
      const candidates = record.filter((value) => !types.has(value) && value.length >= 2);
      const content = candidates.sort((left, right) => right.length - left.length)[0] || '';
      const optionLines: string[] = content.match(/(?:^|\n)\s*[A-Z][.、)]\s*[^\n]+/g) || [];
      const options = optionLines.map((line) => line.replace(/^\s*[A-Z][.、)]\s*/, '').trim());
      const prompt = content.replace(/\n\s*[A-Z][.、)]\s*[^\n]+/g, '').trim() || candidates[0];
      return commonApi.normalizeApiQuestion({ type, title: prompt, problemConfig: { multipleChoiceProblemConfig: { choices: options } } }, index);
    }).filter(Boolean));
  }

  async function responseData(response: Response): Promise<ResponseData> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) return { data: await response.json(), binary: null };
    const binary = new Uint8Array(await response.arrayBuffer());
    try { return { data: JSON.parse(new TextDecoder().decode(binary)), binary: null }; }
    catch (_) { return { data: null, binary }; }
  }

  function apiUrls(): string[] {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === location.origin && parsed.pathname.startsWith('/api/') && API_HINTS.some((hint) => parsed.pathname.includes(`/${hint}`));
      } catch (_) { return false; }
    });
    return [...new Set(urls)];
  }

  function isExamProblemListUrl(url: string): boolean {
    return new URL(url).pathname.endsWith('/exam-problem-list');
  }

  function isExamProblemCollectionUrl(url: string): boolean {
    return new URL(url).pathname.endsWith('/exam-problems');
  }

  function isExamProblemDetailUrl(url: string): boolean {
    return /\/exam-problems\/[^/]+$/.test(new URL(url).pathname);
  }

  function problemSetIdFromUrl(url: string): string | null {
    return new URL(url).pathname.match(/\/problem-sets\/([^/]+)/)?.[1] || null;
  }

  function currentProblemSetPage() {
    const match = location.pathname.match(/^\/problem-sets\/([^/]+)\/exam\/(?:overview|problems\/type\/[^/]+)\/?$/);
    return match ? { id: match[1], path: location.pathname } : null;
  }

  function currentProblemSetId() {
    return currentProblemSetPage()?.id || null;
  }

  async function problemSetMetadata(problemSetId: string): Promise<{ name: string | null; examId: string | null }> {
    const cachedMetadata = problemSetMetadataCache.get(problemSetId);
    if (cachedMetadata) return cachedMetadata;
    const metadataPromise = (async () => {
      const url = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exams`, location.origin);
      const response = requiredResponse(await fetchResponse(url.href), '题集考试信息');
      const result = await responseData(response);
      const root = asRecord(result.data);
      const data = asRecord(root.data || root);
      const problemSet = asRecord(data.problemSet);
      const exam = asRecord(data.exam);
      return {
        name: typeof problemSet.name === 'string' ? problemSet.name : null,
        examId: exam.id ? String(exam.id) : null
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

  async function fetchResponse(url: string, requestDelayMs = 0): Promise<Response | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (requestDelayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, requestDelayMs));
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

  function questionPayload(result: ResponseData): PintiaQuestion[] {
    return result.binary ? extractProtobufQuestions(result.binary) : commonApi.problemSetProblems(result.data);
  }

  function paginationInfo(data: unknown, count: number): { total: number; pageSize: number } {
    const root = asRecord(data);
    const source = asRecord(root.data || root);
    const pagination = asRecord(source.pagination);
    const total = Number(source.total || source.totalCount || pagination.total || 0);
    const pageSize = Number(source.pageSize || source.page_size || source.limit || pagination.pageSize || count);
    return { total, pageSize };
  }

  async function fetchExamUrl(url: string, expectedTotal = 0, requestDelayMs = 0): Promise<PintiaQuestion[]> {
    const first = await fetchResponse(url, requestDelayMs);
    if (!first) return [];
    const firstResult = await responseData(first);
    const requestedType = new URL(url).searchParams.get('problem_type');
    const applyRequestedType = (question: PintiaQuestion) => question.type === 'NO_PROBLEM_TYPE' && requestedType
      ? { ...question, type: commonApi.normalizeType(requestedType, question.options) }
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

  function listData(result: ResponseData): ProblemList {
    const root = asRecord(result.data);
    const source = asRecord(root.data || root);
    const examLabels = Object.fromEntries(
      Object.entries(asRecord(source.examLabelByProblemSetProblemId))
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
    return {
      problems: Array.isArray(source.problemSetProblems)
        ? source.problemSetProblems.filter(isRecord)
        : [],
      total: Number(source.total || source.totalCount || 0),
      examLabelByProblemSetProblemId: examLabels
    };
  }

  async function fetchExamProblemList(url: string, requestDelayMs = 0): Promise<ProblemList> {
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
    const pageCount = pageSize > 0 ? Math.ceil((firstPage.total ?? 0) / pageSize) : 1;
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

  function problemDetailUrl(listUrl: string, problemId: string, problemType: string): string {
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

  function questionCacheKey(listUrl: string, problemType: string): string | null {
    const parsed = new URL(listUrl);
    const problemSetId = parsed.pathname.match(/^\/api\/problem-sets\/([^/]+)\//)?.[1];
    const examId = parsed.searchParams.get('exam_id');
    if (!problemSetId || !examId) return null;
    return `pintia-question-cache:v1:${encodeURIComponent(problemSetId)}:${encodeURIComponent(examId)}:${encodeURIComponent(problemType)}`;
  }

  function sendQuestionCacheMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!isRecord(response)) reject(new Error('题目缓存返回了无效响应。'));
        else if (typeof response.error === 'string') reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  async function readQuestionCache(
    cacheKey: string
  ): Promise<Map<string, { savedAt: number; question: PintiaQuestion }>> {
    try {
      const response = await sendQuestionCacheMessage({ type: 'get-question-cache', cacheKey });
      const entries = asRecord(response.entries);
      return new Map(Object.entries(entries).flatMap(([problemId, value]) => {
        if (!isRecord(value) || typeof value.savedAt !== 'number'
          || !isPintiaQuestion(value.question)) return [];
        return [[problemId, {
          savedAt: value.savedAt,
          question: value.question
        }]];
      }));
    } catch (error) {
      console.warn('读取题目详情缓存失败，将重新请求：', error);
      return new Map();
    }
  }

  async function writeQuestionCache(
    cacheKey: string,
    entries: Map<string, { savedAt: number; question: PintiaQuestion }>
  ): Promise<void> {
    try {
      await sendQuestionCacheMessage({
        type: 'set-question-cache',
        cacheKey,
        entries: Object.fromEntries(entries)
      });
    } catch (error) {
      console.warn('保存题目详情缓存失败：', error);
    }
  }

  function normalizeProblemDetail(
    data: unknown,
    listedProblem: ApiObject | null,
    examLabel: string | null,
    problemType: string
  ): PintiaQuestion | null {
    const root = asRecord(data);
    const nestedData = asRecord(root.data);
    const problemValue = root.problemSetProblem || nestedData.problemSetProblem || root;
    if (!isRecord(problemValue)) return null;
    const problem = problemValue;
    const normalized = commonApi.normalizeApiQuestion({
      ...problem,
      type: problem.type || problem.problem_type || problem.problemType || problem.question_type || problemType,
      id: problem.id || listedProblem?.id,
      number: listedProblem?.problemPoolIndex ?? listedProblem?.indexInProblemPool ?? problem.problemPoolIndex,
      score: problem.score ?? listedProblem?.score
    }, Number(listedProblem?.problemPoolIndex) || 0);
    if (!normalized) return null;
    return {
      ...normalized,
      apiData: {
        ...normalized.apiData,
        examLabel: examLabel || undefined
      }
    };
  }

  async function fetchListedQuestions(
    listUrl: string,
    list: ProblemList,
    detailRequestDelayMs = 0,
    onProgress: ((progress: Record<string, unknown>) => void) | null = null,
    typeProgress: Record<string, unknown> = {},
    forceRefresh = false,
    onQuestion?: (question: PintiaQuestion) => void
  ): Promise<PintiaQuestion[]> {
    const labelById = list.examLabelByProblemSetProblemId || {};
    const problemType = new URL(listUrl).searchParams.get('problem_type');
    const questions = [];
    const listedProblems = list.problems.filter((problem) => problem.id !== undefined && problem.id !== null);
    const cacheKey = questionCacheKey(listUrl, problemType || '');
    const cachedEntries = cacheKey && !forceRefresh
      ? await readQuestionCache(cacheKey)
      : new Map<string, { savedAt: number; question: PintiaQuestion }>();
    for (const [index, listedProblem] of listedProblems.entries()) {
      if (listedProblem.id === undefined || listedProblem.id === null) continue;
      const listedProblemId = String(listedProblem.id);
      let question = null;
      let fetchedDetail = false;
      const cachedQuestion = cachedEntries.get(listedProblemId)?.question;
      if (!forceRefresh && cachedQuestion
        && String(cachedQuestion.id || cachedQuestion.problemId || '') === listedProblemId) {
        question = cachedQuestion;
      } else {
        try {
          const listedType = String(listedProblem.type || listedProblem.problem_type || problemType || 'NO_PROBLEM_TYPE');
          const response = await fetchResponse(
            problemDetailUrl(listUrl, listedProblemId, listedType),
            detailRequestDelayMs
          );
          if (response) {
            question = normalizeProblemDetail(await responseData(response), listedProblem, labelById[listedProblemId], listedType);
            fetchedDetail = question !== null;
          }
        } catch (error) {
          console.warn(`题目详情读取失败（${listedProblemId}）：`, error);
        }
      }
      if (!question) {
        question = commonApi.normalizeApiQuestion({
          ...listedProblem,
          type: listedProblem.type || listedProblem.problem_type || problemType || 'NO_PROBLEM_TYPE',
          number: listedProblem.problemPoolIndex ?? listedProblem.indexInProblemPool
        }, Number(listedProblem.problemPoolIndex) || 0);
      }
      if (question) {
        questions.push(question);
        onQuestion?.(question);
        if (cacheKey && fetchedDetail) {
          cachedEntries.set(listedProblemId, { savedAt: Date.now(), question });
          await writeQuestionCache(cacheKey, cachedEntries);
        }
      }
      onProgress?.({
        ...typeProgress,
        phase: 'details',
        detailCompleted: index + 1,
        detailTotal: listedProblems.length
      });
    }
    return questions;
  }

  function isListBackedProblemType(type: string): boolean {
    return type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING'
      || type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING' || type === 'SUBJECTIVE';
  }

  function typedUrl(url: string | null | undefined, type: string): string | null {
    if (!url) return null;
    const parsed = new URL(url, location.origin);
    parsed.searchParams.delete('problemType');
    parsed.searchParams.delete('type');
    parsed.searchParams.set('problem_type', type);
    return parsed.href;
  }

  function problemListUrl(
    collectionUrl: string | null | undefined,
    observedListUrl: string | null | undefined,
    type: string
  ): string | null {
    if (observedListUrl) return typedUrl(observedListUrl, type);
    if (!collectionUrl) return null;
    const parsed = new URL(collectionUrl, location.origin);
    if (!parsed.pathname.startsWith('/api/exams/') || !parsed.pathname.endsWith('/exam-problems')) return null;
    parsed.pathname = parsed.pathname.replace(/\/exam-problems$/, '/exam-problem-list');
    return typedUrl(parsed.href, type);
  }

  function problemSetListUrl(
    problemSetId: string | null | undefined,
    examId: string | null | undefined,
    type: string
  ): string | null {
    if (!problemSetId || !examId) return null;
    const url = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/exam-problem-list`, location.origin);
    url.searchParams.set('exam_id', examId);
    url.searchParams.set('problem_type', type);
    return url.href;
  }

  function withExamId(url: string | null, examId: string | null | undefined): string | null {
    if (!url || !examId) return url;
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set('exam_id', examId);
    return parsed.href;
  }

  async function fetchQuestionsForType(type: string, options: FetchQuestionOptions = {}): Promise<PintiaQuestion[]> {
    const requestDelayMs = options.requestDelayMs || 0;
    if (isListBackedProblemType(type)) {
      const listUrl = withExamId(problemListUrl(options.collectionUrl, options.listUrl, type), options.examId);
      if (!listUrl) return [];
      const list = await fetchExamProblemList(listUrl, requestDelayMs);
      return fetchListedQuestions(
        listUrl,
        list,
        options.detailRequestDelayMs || 0,
        options.onProgress,
        options.typeProgress,
        options.forceRefresh,
        options.onQuestion
      );
    }
    const collectionUrl = withExamId(typedUrl(options.collectionUrl, type), options.examId);
    if (!collectionUrl) return [];
    const questions = await fetchExamUrl(collectionUrl, options.expectedTotal || 0, requestDelayMs);
    questions.forEach((question) => options.onQuestion?.(question));
    return questions;
  }

  function requiredResponse(response: Response | null, label: string): Response {
    if (!response) throw new Error(`${label}读取失败，请确认已登录且有权访问该作业。`);
    return response;
  }

  function reviewSubmissionUrl(
    examId: string,
    problemSetId: string,
    type: string,
    problemSetProblemId?: string
  ): string {
    const url = new URL(`/api/exams/${encodeURIComponent(examId)}/problem-sets/${encodeURIComponent(problemSetId)}/last-submissions`, location.origin);
    url.searchParams.set('problem_type', type);
    if (problemSetProblemId) url.searchParams.set('problem_set_problem_id', problemSetProblemId);
    return url.href;
  }

  let reviewProblemSetsCache: PintiaProblemSet[] | null = null;
  let reviewProblemSetsPromise: Promise<PintiaProblemSet[]> | null = null;
  async function listProblemSets() {
    if (reviewProblemSetsCache) return reviewProblemSetsCache;
    if (reviewProblemSetsPromise) return reviewProblemSetsPromise;
    reviewProblemSetsPromise = (async () => {
      const setsById = new Map();
      const examIds: Record<string, string | number> = {};
      let page = 0;
      let total = Infinity;
      while (setsById.size < total) {
        const url = new URL('/api/problem-sets', location.origin);
        url.searchParams.set('filter', '{}');
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', '30');
        url.searchParams.set('order_by', 'END_AT');
        url.searchParams.set('asc', 'false');
        const response = requiredResponse(await fetchResponse(url.href), '题目集列表');
        const result = await responseData(response);
        const root = asRecord(result.data);
        const data = asRecord(root.data || root);
        const sets = Array.isArray(data.problemSets)
          ? data.problemSets.filter((set): set is PintiaProblemSet =>
            isRecord(set)
            && (typeof set.id === 'string' || typeof set.id === 'number')
            && typeof set.name === 'string')
          : [];
        if (!sets.length) break;
        sets.forEach((set) => setsById.set(String(set.id), set));
        Object.entries(asRecord(data.examIdByProblemSetId)).forEach(([id, examId]) => {
          if (typeof examId === 'string' || typeof examId === 'number') examIds[id] = examId;
        });
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
  }

  async function extractProblemSetForReview(
    problemSet: PintiaProblemSet,
    detailRequestDelayMs = 1000,
    includeSubmissions = true
  ) {
    const problemSetId = String(problemSet?.id || '');
    const examId = String(problemSet?.examId || '');
    if (!problemSetId || !examId) throw new Error('作业缺少考试 ID，无法读取题目及作答。');

    const summaryUrl = new URL(`/api/problem-sets/${encodeURIComponent(problemSetId)}/problem-summaries`, location.origin);
    const summaryResponse = requiredResponse(await fetchResponse(summaryUrl.href), '题型摘要');
    const summaryData = await responseData(summaryResponse);
    const summaryRoot = asRecord(summaryData.data);
    const summaryDataObject = asRecord(summaryRoot.data || summaryRoot);
    const summaries = asRecord(summaryRoot.summaries || summaryDataObject.summaries);
    const types = Object.entries(summaries)
      .filter(([, summary]) => Number(asRecord(summary).total || 0) > 0)
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
        expectedTotal: Number(asRecord(summaries[type]).total || 0),
        detailRequestDelayMs
      });
      if (!typeQuestions.length) {
        throw new Error(`${type}题目读取失败：接口未返回可导出的题目。`);
      }
      questions.push(...typeQuestions);

      if (!includeSubmissions) continue;
      if (isListBackedProblemType(type)) {
        for (const [index, question] of typeQuestions.entries()) {
          const problemSetProblemId = String(question.id || question.problemId || '');
          if (!problemSetProblemId) {
            throw new Error(`${type}题目缺少 ID，无法读取对应的最近作答记录。`);
          }
          if (index > 0 && detailRequestDelayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, detailRequestDelayMs));
          }
          const response = requiredResponse(
            await fetchResponse(reviewSubmissionUrl(examId, problemSetId, type, problemSetProblemId)),
            `${type}题目 ${problemSetProblemId} 作答记录`
          );
          const result = await responseData(response);
          for (const [id, submission] of submissionResults(result.data || {}, problemSetProblemId).entries()) {
            submissions.set(id, submission);
          }
        }
      } else {
        const response = requiredResponse(
          await fetchResponse(reviewSubmissionUrl(examId, problemSetId, type)),
          `${type}作答记录`
        );
        const result = await responseData(response);
        for (const [id, submission] of submissionResults(result.data || {}).entries()) {
          submissions.set(id, submission);
        }
      }
    }

    const uniqueQuestions = commonApi.uniqueQuestions(questions);
    return {
      title: problemSet.name || 'Pintia 作业',
      problemSetName: problemSet.name || 'Pintia 作业',
      problemSetId,
      source: `${location.origin}/problem-sets/${encodeURIComponent(problemSetId)}`,
      extraction: 'api',
      exportedAt: new Date().toISOString(),
      summaries,
      questions: uniqueQuestions.map((question) => ({
        ...question,
        submission: submissions.get(String(question.id || '')) || null
      }))
    };
  }

  async function extractFromApi(options: PintiaExtractOptions = {}) {
    lastFailureReason = null;
    const detailRequestDelayMs = options.detailRequestDelayMs ?? 1000;
    if (!Number.isInteger(detailRequestDelayMs) || detailRequestDelayMs < 0 || detailRequestDelayMs > 10000) {
      throw new Error('题目详情间隔必须是 0 到 10000 毫秒之间的整数。');
    }
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
    let metadata: { name: string | null; examId: string | null } = { name: null, examId: null };
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
    let summaries: Record<string, unknown> = {};
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
        const resultRoot = asRecord(result.data);
        const resultData = asRecord(resultRoot.data || resultRoot);
        summaries = asRecord(resultRoot.summaries || resultData.summaries);
        if (Object.keys(summaries).length) break;
      } catch (_) { /* The exam request can still be used. */ }
    }
    const examUrl = examUrls.find((url) => new URL(url).searchParams.has('problem_type')) || examUrls[0];
    const types = Object.keys(summaries).length
      ? Object.entries(summaries)
        .filter(([, summary]) => Number(asRecord(summary).total || 0) > 0)
        .map(([type]) => type)
      : [...examUrls, ...examProblemListUrls]
        .map((url) => new URL(url).searchParams.get('problem_type'))
        .filter((type): type is string => type !== null);
    const questions = [];
    const observedListUrl = examProblemListUrls.find((url) => new URL(url).searchParams.has('problem_type')) || examProblemListUrls[0];
    const fallbackExamUrl = examId && problemSetId
      ? new URL(`/api/exams/${encodeURIComponent(examId)}/problem-sets/${encodeURIComponent(problemSetId)}/exam-problems`, location.origin).href
      : null;
    for (const [typeIndex, type] of types.entries()) {
      const typeProgress = { type, typeIndex: typeIndex + 1, typeCount: types.length };
      options.onProgress?.({ ...typeProgress, phase: 'type' });
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
          expectedTotal: Number(asRecord(summaries[type]).total || 0),
          detailRequestDelayMs,
          forceRefresh: options.forceRefresh,
          onQuestion: (question) => options.onQuestion?.(question, problemSetId),
          onProgress: options.onProgress,
          typeProgress
        }));
        options.onProgress?.({ ...typeProgress, phase: 'type-complete' });
      } catch (error) {
        console.warn(`${type}题目读取失败：`, error);
      }
    }
    for (const url of examDetailUrls) {
      try {
        const response = await fetchResponse(url, detailRequestDelayMs);
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
    const uniqueQuestions = commonApi.uniqueQuestions(questions);
    return {
      problemSetId,
      problemSetName: metadata.name,
      examId,
      questions: uniqueQuestions,
      summaries,
      reason: uniqueQuestions.length ? null : (lastFailureReason || 'no_questions')
    };
  }

export const pintiaExtractor: PintiaExtractorApi = {
  ...commonApi,
  currentProblemSetPage,
  listProblemSets,
  extractProblemSetForReview,
  extractFromApi
};