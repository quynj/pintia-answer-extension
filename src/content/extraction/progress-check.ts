export interface QuestionProgress {
  completed: number;
  total: number;
  percentage: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePintiaTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1_000_000_000_000) return value;
    if (value >= 1_000_000_000) return value * 1000;
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d{10,13}$/.test(value.trim())) return parsePintiaTimestamp(Number(value));
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2}|GMT)$/.test(value.trim())) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function serverTimeFromResponse(value: unknown, dateHeader: string | null): number | null {
  const findServerTime = (candidate: unknown, depth: number): number | null => {
    if (!isRecord(candidate) || depth > 4) return null;
    for (const key of ['serverTime', 'server_time', 'serverNow', 'currentTime', 'current_time']) {
      if (key in candidate) {
        const timestamp = parsePintiaTimestamp(candidate[key]);
        if (timestamp !== null) return timestamp;
      }
    }
    for (const key of ['data', 'exam', 'problemSet']) {
      const timestamp = findServerTime(candidate[key], depth + 1);
      if (timestamp !== null) return timestamp;
    }
    return null;
  };
  return findServerTime(value, 0) ?? parsePintiaTimestamp(dateHeader);
}

export function progressDeadline(
  examEndAt: unknown,
  problemSetEndAt: unknown,
  listedEndAt: unknown
): number | null {
  const authoritativeEndAt = [examEndAt, problemSetEndAt, listedEndAt]
    .find((value) => value !== undefined && value !== null && value !== '');
  return parsePintiaTimestamp(authoritativeEndAt);
}

export function examResponseData(value: unknown): Record<string, unknown> {
  let data = isRecord(value) ? value : {};
  for (let depth = 0; depth < 4 && isRecord(data.data); depth += 1) {
    data = data.data;
  }
  return data;
}

export function progressDeadlineFromExamResponse(value: unknown, listedEndAt: unknown): number | null {
  const data = examResponseData(value);
  const exam = isRecord(data.exam) ? data.exam : {};
  const problemSet = isRecord(data.problemSet) ? data.problemSet : {};
  return progressDeadline(exam.endAt, problemSet.endAt, listedEndAt);
}

export function isPastProgressDeadline(deadline: number, serverNow: number): boolean {
  return serverNow >= deadline;
}

export function problemStatusEntriesFromResponse(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  const data = isRecord(value.data) ? value.data : {};
  const entries = Array.isArray(data.problemStatus) ? data.problemStatus : value.problemStatus;
  return Array.isArray(entries) ? entries : [];
}

export function calculateQuestionProgress(entries: unknown[]): QuestionProgress {
  if (!entries.length) throw new Error('题目状态列表为空。');
  const statusById = new Map<string, string>();
  const validStatuses = new Set([
    'PROBLEM_NO_ANSWER',
    'PROBLEM_SUBMITTED',
    'PROBLEM_WRONG_ANSWER',
    'PROBLEM_ACCEPTED'
  ]);
  for (const entry of entries) {
    if (!isRecord(entry)) throw new Error('题目状态数据结构无效。');
    const rawId = [entry.id, entry.problemSetProblemId, entry.problem_set_problem_id, entry.problemId, entry.problem_id, entry.questionId]
      .find((candidate) => (typeof candidate === 'string' || typeof candidate === 'number')
        && String(candidate).trim());
    if (typeof rawId !== 'string' && typeof rawId !== 'number') {
      throw new Error('题目状态缺少题目 ID。');
    }
    const id = String(rawId).trim();
    if (!id) throw new Error('题目状态缺少题目 ID。');
    const rawStatus = entry.problemSubmissionStatus
      ?? entry.problem_submission_status
      ?? entry.problemStatus
      ?? entry.problem_status
      ?? entry.status;
    const statusValue = isRecord(rawStatus) ? rawStatus.status : rawStatus;
    if (typeof statusValue !== 'string' || !validStatuses.has(statusValue)) {
      throw new Error('题目状态缺失或无法识别。');
    }
    const status = statusValue;
    const existingStatus = statusById.get(id);
    if (existingStatus && existingStatus !== status) {
      throw new Error('重复题目的状态不一致。');
    }
    statusById.set(id, status);
  }
  if (!statusById.size) throw new Error('题目状态列表为空。');
  const total = statusById.size;
  const completed = [...statusById.values()].filter((status) => status !== 'PROBLEM_NO_ANSWER').length;
  return {
    completed,
    total,
    percentage: Math.floor((completed / total) * 100)
  };
}
