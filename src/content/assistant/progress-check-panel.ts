import type { PintiaProblemSet, PintiaProblemSetProgress } from '../../shared/types';
import { parsePintiaTimestamp } from '../extraction/progress-check';

interface ProgressCheckPanelDependencies {
  loadProblemSets: (panel: HTMLElement) => Promise<PintiaProblemSet[]>;
  sendRuntimeMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requiredElement: <T extends HTMLElement>(panel: HTMLElement, selector: string) => T;
  setLog: (panel: HTMLElement, message: string, level?: string) => void;
}

const EXPIRED_PROBLEM_SET_IDS_KEY = 'progressExpiredProblemSetIds';
const LEGACY_EXPIRED_PROBLEM_SET_PREFIX = 'progressExpiredProblemSet:';
const PROGRESS_SNAPSHOT_KEY = 'progressCheckSnapshot';

interface ProgressSnapshot {
  checkedAt: number;
  results: PintiaProblemSetProgress[];
}

function storedExpiredIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
}

async function loadExpiredProblemSetIds(problemSets: PintiaProblemSet[]): Promise<Set<string>> {
  const legacyKeys = problemSets.map((problemSet) =>
    `${LEGACY_EXPIRED_PROBLEM_SET_PREFIX}${String(problemSet.id)}`
  );
  const stored = await chrome.storage.local.get([EXPIRED_PROBLEM_SET_IDS_KEY, ...legacyKeys]);
  const expiredIds = new Set(storedExpiredIds(stored[EXPIRED_PROBLEM_SET_IDS_KEY]));
  const legacyKeysToRemove: string[] = [];
  problemSets.forEach((problemSet, index) => {
    const legacyKey = legacyKeys[index];
    if (stored[legacyKey] === true) expiredIds.add(String(problemSet.id));
    if (stored[legacyKey] !== undefined) legacyKeysToRemove.push(legacyKey);
  });
  if (legacyKeysToRemove.length) {
    await chrome.storage.local.set({ [EXPIRED_PROBLEM_SET_IDS_KEY]: [...expiredIds] });
    await chrome.storage.local.remove(legacyKeysToRemove);
  }
  return expiredIds;
}

async function persistExpiredProblemSetIds(expiredIds: Set<string>, problemSetId: string): Promise<void> {
  const stored = await chrome.storage.local.get(EXPIRED_PROBLEM_SET_IDS_KEY);
  const mergedIds = new Set(storedExpiredIds(stored[EXPIRED_PROBLEM_SET_IDS_KEY]));
  expiredIds.forEach((id) => mergedIds.add(id));
  mergedIds.add(problemSetId);
  await chrome.storage.local.set({ [EXPIRED_PROBLEM_SET_IDS_KEY]: [...mergedIds] });
  expiredIds.clear();
  mergedIds.forEach((id) => expiredIds.add(id));
}

function isProgressResult(value: unknown): value is PintiaProblemSetProgress {
  if (!isRecord(value)) return false;
  const result = value;
  if (typeof result.problemSetId !== 'string'
    || typeof result.problemSetName !== 'string'
    || typeof result.state !== 'string') return false;
  if ('deadline' in result
    && result.deadline !== null
    && (typeof result.deadline !== 'number' || !Number.isFinite(result.deadline))) return false;
  if (result.state === 'complete' || result.state === 'incomplete') {
    return typeof result.completed === 'number'
      && typeof result.total === 'number'
      && typeof result.percentage === 'number'
      && result.total > 0
      && result.completed >= 0
      && result.completed <= result.total
      && result.percentage >= 0
      && result.percentage <= 100
      && Number.isInteger(result.completed)
      && Number.isInteger(result.total)
      && Number.isInteger(result.percentage)
      && (result.state !== 'complete' || (result.completed === result.total && result.percentage === 100))
      && (result.state !== 'incomplete' || result.completed < result.total);
  }
  return (result.state === 'expired' || result.state === 'unavailable')
    && result.completed === null
    && result.total === null
    && result.percentage === null
    && (result.reason === undefined || typeof result.reason === 'string');
}

function isProgressSnapshot(value: unknown): value is ProgressSnapshot {
  return isRecord(value)
    && typeof value.checkedAt === 'number'
    && Number.isFinite(value.checkedAt)
    && Array.isArray(value.results)
    && value.results.every((result) => isProgressResult(result) && result.state !== 'expired');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createProgressCheckPanel({
  loadProblemSets,
  sendRuntimeMessage,
  requiredElement,
  setLog
}: ProgressCheckPanelDependencies) {
  let checking = false;
  let cacheLoaded = false;
  let cacheLoadGeneration = 0;

  function progressProblemSetInterval(panel: HTMLElement): number {
    const delay = Number(requiredElement<HTMLInputElement>(panel, '[data-progress-delay]').value);
    if (!Number.isInteger(delay) || delay < 0 || delay > 10000) {
      throw new Error('进度检查题集间隔必须是 0 到 10000 毫秒之间的整数。');
    }
    return delay;
  }

  function rowForResult(result: PintiaProblemSetProgress): HTMLLIElement {
    const item = document.createElement('li');
    const name = document.createElement('a');
    name.href = new URL(`/problem-sets/${encodeURIComponent(result.problemSetId)}`, window.location.origin).href;
    name.target = '_blank';
    name.rel = 'noopener noreferrer';
    name.textContent = result.problemSetName || '未命名题目集';
    const detail = document.createElement('span');
    if (result.state === 'complete') {
      detail.textContent = `已完成 · ${result.completed}/${result.total}，${result.percentage}%`;
    } else if (result.state === 'incomplete') {
      detail.textContent = `未完成 · ${result.completed}/${result.total}，${result.percentage}%`;
    } else if (result.state === 'expired') {
      detail.textContent = '已截止 · 跳过未完成判断';
    } else {
      detail.textContent = `进度暂不可用${result.reason ? ` · ${result.reason}` : ''}`;
    }
    const deadline = document.createElement('time');
    const deadlineDate = typeof result.deadline === 'number' ? new Date(result.deadline) : null;
    if (deadlineDate && Number.isFinite(deadlineDate.getTime())) {
      deadline.dateTime = deadlineDate.toISOString();
      deadline.textContent = `截止：${deadlineDate.toLocaleString()}`;
    } else {
      deadline.textContent = '截止时间未知';
    }
    item.append(name, detail, deadline);
    return item;
  }

  function renderResultGroup(
    container: HTMLElement,
    title: string,
    items: PintiaProblemSetProgress[]
  ): void {
    const group = document.createElement('section');
    group.className = 'pintia-progress-group';
    const heading = document.createElement('div');
    heading.className = 'pintia-progress-group-heading';
    const label = document.createElement('strong');
    label.textContent = title;
    const count = document.createElement('span');
    count.textContent = String(items.length);
    heading.append(label, count);
    group.appendChild(heading);

    if (items.length) {
      const list = document.createElement('ul');
      list.setAttribute('aria-label', title);
      items.forEach((item) => list.appendChild(rowForResult(item)));
      group.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.className = 'pintia-progress-empty';
      empty.textContent = '暂无题目集';
      group.appendChild(empty);
    }
    container.appendChild(group);
  }

  function renderResults(container: HTMLElement, items: PintiaProblemSetProgress[]): void {
    const incomplete = items.filter((item) => item.state !== 'complete');
    const complete = items.filter((item) => item.state === 'complete');
    container.replaceChildren();
    renderResultGroup(container, '未完成（含暂不可用）', incomplete);
    renderResultGroup(container, '已完成', complete);
  }

  async function showCachedProgress(panel: HTMLElement): Promise<void> {
    if (cacheLoaded || checking) return;
    const generation = ++cacheLoadGeneration;
    const status = requiredElement<HTMLElement>(panel, '[data-progress-status]');
    try {
      const stored = await chrome.storage.local.get(PROGRESS_SNAPSHOT_KEY);
      if (checking || generation !== cacheLoadGeneration) return;
      cacheLoaded = true;
      const snapshot = stored[PROGRESS_SNAPSHOT_KEY];
      if (snapshot === undefined) {
        status.textContent = '暂无缓存进度，请点击“手动检查进度”获取最新结果。';
        return;
      }
      if (!isProgressSnapshot(snapshot)) {
        status.textContent = '缓存进度格式无效，请手动重新检查。';
        setLog(panel, '已保存的进度缓存格式无效，请手动重新检查。', 'warn');
        return;
      }
      renderResults(requiredElement(panel, '[data-progress-results]'), snapshot.results);
      status.textContent = `显示最近检查结果（${new Date(snapshot.checkedAt).toLocaleString()}）；点击“手动检查进度”可更新。`;
    } catch (error) {
      if (checking || generation !== cacheLoadGeneration) return;
      status.textContent = `读取缓存进度失败：${error instanceof Error ? error.message : '存储读取失败。'}`;
      setLog(panel, status.textContent, 'error');
    }
  }

  async function saveProgressSnapshot(
    panel: HTMLElement,
    results: PintiaProblemSetProgress[],
    checkedAt: number
  ): Promise<string | null> {
    try {
      await chrome.storage.local.set({
        [PROGRESS_SNAPSHOT_KEY]: { checkedAt, results }
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : '存储失败。';
      setLog(panel, `进度已检查，但无法保存进度缓存：${message}`, 'error');
      return message;
    }
  }

  function unavailableResult(problemSet: PintiaProblemSet, reason: string): PintiaProblemSetProgress {
    return {
      problemSetId: String(problemSet.id),
      problemSetName: problemSet.name,
      state: 'unavailable',
      completed: null,
      total: null,
      percentage: null,
      deadline: parsePintiaTimestamp(problemSet.endAt),
      reason
    };
  }

  async function checkProgress(panel: HTMLElement): Promise<void> {
    if (checking) return;
    checking = true;
    cacheLoadGeneration += 1;
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="check-progress"]');
    const status = requiredElement<HTMLElement>(panel, '[data-progress-status]');
    const results = requiredElement<HTMLElement>(panel, '[data-progress-results]');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = '正在读取题目集列表…';
    try {
      const problemSets = await loadProblemSets(panel);
      const expiredIds = await loadExpiredProblemSetIds(problemSets);
      const problemSetsToCheck = problemSets.filter((problemSet) => !expiredIds.has(String(problemSet.id)));
      const delay = problemSetsToCheck.length > 1 ? progressProblemSetInterval(panel) : 0;
      if (!problemSetsToCheck.length) {
        const checkedAt = Date.now();
        renderResults(results, []);
        cacheLoaded = true;
        const cacheError = await saveProgressSnapshot(panel, [], checkedAt);
        status.textContent = `${problemSets.length ? '没有需要检查的活跃题目集。' : '未找到题目集。'}（${new Date(checkedAt).toLocaleString()}）${cacheError ? ` 进度缓存保存失败：${cacheError}` : ''}`;
        return;
      }

      setLog(panel, `开始检查 ${problemSetsToCheck.length} 套题目集；题集间隔 ${delay} 毫秒。`);
      let unavailableCount = 0;
      let checkedCount = 0;
      let newlyExpiredCount = 0;
      const currentResults: PintiaProblemSetProgress[] = [];
      for (const [index, problemSet] of problemSetsToCheck.entries()) {
        if (index > 0 && delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
        status.textContent = `正在检查题目集 ${index + 1}/${problemSetsToCheck.length}：${problemSet.name}`;
        checkedCount += 1;
        let result: PintiaProblemSetProgress;
        try {
          const response = await sendRuntimeMessage({
            type: 'check-review-problem-set-progress',
            problemSet
          });
          if (!isProgressResult(response.result)) throw new Error('接口返回了无效的进度数据。');
          result = response.result;
        } catch (error) {
          result = unavailableResult(problemSet, error instanceof Error ? error.message : '请求失败。');
        }
        if (result.state === 'expired') {
          newlyExpiredCount += 1;
          expiredIds.add(result.problemSetId);
          try {
            await persistExpiredProblemSetIds(expiredIds, result.problemSetId);
          } catch (error) {
            setLog(
              panel,
              `已确认题目集“${problemSet.name}”过期，但无法持久化跳过记录：${error instanceof Error ? error.message : '存储失败。'}`,
              'error'
            );
          }
          continue;
        }
        if (result.state === 'unavailable') unavailableCount += 1;
        currentResults.push(result);
      }
      renderResults(results, currentResults);
      const checkedAt = Date.now();
      const cacheError = await saveProgressSnapshot(panel, currentResults, checkedAt);
      cacheLoaded = true;
      status.textContent = `检查完成（${new Date(checkedAt).toLocaleString()}）：请求 ${checkedCount} 套，跳过 ${expiredIds.size} 套已过期题目集，${unavailableCount} 套进度暂不可用。${cacheError ? ` 进度缓存保存失败：${cacheError}` : ''}`;
      setLog(
        panel,
        `进度检查完成：请求 ${checkedCount} 套，新增过期记录 ${newlyExpiredCount} 套，${unavailableCount} 套暂不可用。`,
        unavailableCount ? 'warn' : 'success'
      );
    } catch (error) {
      status.textContent = `进度检查失败：${error instanceof Error ? error.message : '请求失败。'}`;
      setLog(panel, status.textContent, 'error');
    } finally {
      checking = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  return { checkProgress, showCachedProgress, progressProblemSetInterval };
}
