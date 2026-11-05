import { reviewMarkdown } from '../extraction/review-markdown';
import { reviewAnswerPayload } from '../extraction/review-submissions';
import type { PintiaProblemSet, PintiaQuestionBankResult } from '../../shared/types';

interface ReviewExportState {
  reviewProblemSets: PintiaProblemSet[];
  problemSetId: string | null;
}

interface ReviewExportPanelDependencies {
  state: ReviewExportState;
  requiredElement: <T extends HTMLElement>(panel: HTMLElement, selector: string) => T;
  isQuestionBankResult: (value: unknown) => value is PintiaQuestionBankResult;
  isProblemSet: (value: unknown) => value is PintiaProblemSet;
  sendRuntimeMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  setStatus: (panel: HTMLElement, message: string) => void;
  setLog: (panel: HTMLElement, message: string, level?: string) => void;
  appendLog: (panel: HTMLElement | null, message: string, level?: string) => void;
  errorMessage: (error: unknown, fallback?: string) => string;
}

export function createReviewExportPanel({
  state,
  requiredElement,
  isQuestionBankResult,
  isProblemSet,
  sendRuntimeMessage,
  setStatus,
  setLog,
  appendLog,
  errorMessage
}: ReviewExportPanelDependencies) {
  function reviewProblemSetInterval(panel: HTMLElement): number {
    const input = requiredElement<HTMLInputElement>(panel, '[data-review-delay]');
    const delay = Number(input.value);
    if (!Number.isInteger(delay) || delay < 0 || delay > 10000) {
      throw new Error('题集间隔必须是 0 到 10000 毫秒之间的整数。');
    }
    return delay;
  }

  function problemDetailRequestDelay(panel: HTMLElement): number {
    const input = requiredElement<HTMLInputElement>(panel, '[data-problem-detail-delay]');
    const delay = Number(input.value);
    if (!Number.isInteger(delay) || delay < 0 || delay > 10000) {
      throw new Error('题目详情间隔必须是 0 到 10000 毫秒之间的整数。');
    }
    return delay;
  }

  function downloadReviewMarkdown(
    result: PintiaQuestionBankResult,
    includeAnswers: boolean
  ): Promise<{ downloadId: number; filename: string }> {
    return sendRuntimeMessage({
      type: 'download-review-markdown',
      filename: reviewMarkdown.filename(result),
      markdown: reviewMarkdown.render(result, includeAnswers)
    }).then((response) => {
      if (typeof response.downloadId !== 'number' || typeof response.filename !== 'string') {
        throw new Error('后台返回了无效的下载结果。');
      }
      return { downloadId: response.downloadId, filename: response.filename };
    });
  }

  function downloadJson(filename: string, value: unknown): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectedProblemSets(panel: HTMLElement): PintiaProblemSet[] {
    const selectedIds = new Set([...panel.querySelectorAll<HTMLInputElement>('[data-review-set]:checked')].map((input) => input.value));
    const problemSets = state.reviewProblemSets.filter((set) => selectedIds.has(String(set.id)) && set.examId);
    if (!problemSets.length) throw new Error('请至少选择一套具有考试 ID 的题目集。');
    return problemSets;
  }

  function problemSetFilename(problemSet: PintiaProblemSet, suffix: string): string {
    const safeName = (problemSet.name || 'pintia')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80) || 'pintia';
    return `${safeName}-${suffix}.json`;
  }

  async function exportSelectedReviewSets(panel: HTMLElement): Promise<void> {
    const problemSets = selectedProblemSets(panel);
    const setIntervalMs = problemSets.length > 1 ? reviewProblemSetInterval(panel) : 0;
    const detailRequestDelayMs = problemDetailRequestDelay(panel);
    const includeAnswers = requiredElement<HTMLInputElement>(panel, '[data-review-include-answers]').checked;
    const requestSettings: Record<string, number> = { problemDetailRequestDelayMs: detailRequestDelayMs };
    if (problemSets.length > 1) requestSettings.reviewExportRequestDelayMs = setIntervalMs;
    await chrome.storage.local.set(requestSettings);
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-sets"]');
    button.disabled = true;
    let exportedCount = 0;
    try {
      setLog(panel, `开始导出 ${problemSets.length} 套题目集；题集间隔 ${setIntervalMs} 毫秒，题目详情间隔 ${detailRequestDelayMs} 毫秒。`);
      for (const [index, problemSet] of problemSets.entries()) {
        if (index > 0 && setIntervalMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, setIntervalMs));
        }
        setStatus(panel, `正在导出：${problemSet.name}`);
        appendLog(panel, `读取题目集：${problemSet.name || '未命名题目集'}`);
        const response = await sendRuntimeMessage({
          type: 'export-review-problem-set',
          problemSet,
          detailRequestDelayMs
        });
        if (!isQuestionBankResult(response.result)) throw new Error('后台返回了无效的题目集数据。');
        const download = await downloadReviewMarkdown(response.result, includeAnswers);
        exportedCount += 1;
        setLog(panel, `下载完成：${download.filename}（${exportedCount}/${problemSets.length}）。`);
      }
      setStatus(panel, 'Markdown 导出完成');
      setLog(panel, `Markdown 导出完成，共 ${exportedCount} 个文件。`);
    } catch (error) {
      setStatus(panel, 'Markdown 导出未全部完成');
      setLog(panel, `已导出 ${exportedCount} 个 Markdown 文件后失败：${errorMessage(error)}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function exportSelectedReviewAnswers(panel: HTMLElement): Promise<void> {
    const problemSets = selectedProblemSets(panel);
    const setIntervalMs = problemSets.length > 1 ? reviewProblemSetInterval(panel) : 0;
    const detailRequestDelayMs = problemDetailRequestDelay(panel);
    await chrome.storage.local.set({
      problemDetailRequestDelayMs: detailRequestDelayMs,
      ...(problemSets.length > 1 ? { reviewExportRequestDelayMs: setIntervalMs } : {})
    });
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-answers"]');
    button.disabled = true;
    let exportedCount = 0;
    try {
      for (const [index, problemSet] of problemSets.entries()) {
        if (index > 0 && setIntervalMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, setIntervalMs));
        }
        setStatus(panel, `正在导出答案：${problemSet.name}`);
        const response = await sendRuntimeMessage({
          type: 'export-review-problem-set',
          problemSet,
          detailRequestDelayMs
        });
        if (!isQuestionBankResult(response.result) || typeof response.result.problemSetId !== 'string') {
          throw new Error('后台返回了无效的题目集答案数据。');
        }
        const payload = reviewAnswerPayload(response.result.problemSetId, response.result.questions);
        if (!payload.answers.length) {
          throw new Error(`“${problemSet.name}”没有可导出的最近作答记录。`);
        }
        const filename = problemSetFilename(problemSet, '我的答案');
        downloadJson(filename, { problemSetId: payload.problemSetId, answers: payload.answers });
        exportedCount += 1;
        appendLog(
          panel,
          `${problemSet.name}：已导出 ${payload.answers.length} 道答案，略过 ${payload.skippedCount} 道无作答或格式不兼容的题目。`,
          payload.skippedCount ? 'warn' : 'success'
        );
      }
      setStatus(panel, '答案 JSON 导出完成');
      setLog(panel, `答案 JSON 导出完成，共 ${exportedCount} 个文件。`);
    } catch (error) {
      setStatus(panel, '答案 JSON 导出未全部完成');
      setLog(panel, `已导出 ${exportedCount} 个答案 JSON 文件后失败：${errorMessage(error)}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function exportSelectedQuestionBanks(panel: HTMLElement): Promise<void> {
    const problemSets = selectedProblemSets(panel);
    const setIntervalMs = problemSets.length > 1 ? reviewProblemSetInterval(panel) : 0;
    const detailRequestDelayMs = problemDetailRequestDelay(panel);
    await chrome.storage.local.set({
      problemDetailRequestDelayMs: detailRequestDelayMs,
      ...(problemSets.length > 1 ? { reviewExportRequestDelayMs: setIntervalMs } : {})
    });
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-question-bank"]');
    button.disabled = true;
    let exportedCount = 0;
    try {
      for (const [index, problemSet] of problemSets.entries()) {
        if (index > 0 && setIntervalMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, setIntervalMs));
        }
        setStatus(panel, `正在导出题库：${problemSet.name}`);
        const response = await sendRuntimeMessage({
          type: 'export-review-problem-set',
          problemSet,
          detailRequestDelayMs,
          includeSubmissions: false
        });
        if (!isQuestionBankResult(response.result) || typeof response.result.problemSetId !== 'string') {
          throw new Error('后台返回了无效的题目集题库数据。');
        }
        const result = response.result;
        const questionBank: PintiaQuestionBankResult = {
          title: result.title || problemSet.name,
          problemSetName: problemSet.name,
          problemSetId: result.problemSetId,
          examId: problemSet.examId || null,
          source: result.source,
          extraction: 'api',
          exportedAt: new Date().toISOString(),
          summaries: result.summaries || {},
          questions: result.questions.map((question) => {
            const cleanQuestion = { ...question };
            delete cleanQuestion.submission;
            return cleanQuestion;
          })
        };
        const filename = problemSetFilename(problemSet, '题库');
        downloadJson(filename, questionBank);
        exportedCount += 1;
        appendLog(panel, `题库导出完成：${filename}（${exportedCount}/${problemSets.length}）。`, 'success');
      }
      setStatus(panel, '题库 JSON 导出完成');
      setLog(panel, `题库 JSON 导出完成，共 ${exportedCount} 个文件。`);
    } catch (error) {
      setStatus(panel, '题库 JSON 导出未全部完成');
      setLog(panel, `已导出 ${exportedCount} 个题库 JSON 文件后失败：${errorMessage(error)}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function updateReviewDelayVisibility(panel: HTMLElement): void {
    const selectedIds = new Set([...panel.querySelectorAll<HTMLInputElement>('[data-review-set]:checked')].map((input) => input.value));
    const selectedSets = state.reviewProblemSets.filter((set) => selectedIds.has(String(set.id)) && set.examId);
    const visible = selectedSets.length > 1;
    requiredElement(panel, '[data-review-delay-option]').hidden = !visible;
    requiredElement(panel, '[data-review-delay-hint]').hidden = !visible;
    requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-sets"]').disabled = !selectedSets.length;
    requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-answers"]').disabled = !selectedSets.length;
    requiredElement<HTMLButtonElement>(panel, '[data-action="export-review-question-bank"]').disabled = !selectedSets.length;
    const selectedContainer = requiredElement<HTMLElement>(panel, '[data-selected-review-container]');
    const selectedList = requiredElement<HTMLUListElement>(panel, '[data-selected-review-sets]');
    requiredElement(panel, '[data-selected-review-count]').textContent = String(selectedSets.length);
    selectedList.replaceChildren(...selectedSets.map((problemSet) => {
      const item = document.createElement('li');
      const isCurrent = String(problemSet.id) === String(state.problemSetId);
      item.textContent = `${problemSet.name || '未命名题目集'}${isCurrent ? '（当前）' : ''}`;
      return item;
    }));
    selectedContainer.hidden = !selectedSets.length;
  }

  async function loadReviewProblemSets(
    panel: HTMLElement,
    currentSetId: string | null = null,
    automatic = false
  ): Promise<void> {
    const button = requiredElement<HTMLButtonElement>(panel, '[data-action="load-review-sets"]');
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (!automatic) {
      setStatus(panel, '正在加载题目集');
      setLog(panel, '开始加载题目集列表。');
    }
    requiredElement(panel, '[data-review-count]').textContent = '正在获取数量…';
    requiredElement(panel, '[data-loader-label]').textContent = '正在加载…';
    try {
      const response = await sendRuntimeMessage({ type: 'list-review-problem-sets' });
      if (!Array.isArray(response.problemSets) || !response.problemSets.every(isProblemSet)) {
        throw new Error('后台返回了无效的题目集列表。');
      }
      const uniqueProblemSets = [...new Map<string, PintiaProblemSet>(
        response.problemSets.map((problemSet) => [String(problemSet.id), problemSet] as const)
      ).values()];
      const currentSet = state.reviewProblemSets.find(
        (problemSet) => String(problemSet.id) === String(state.problemSetId)
      );
      if (currentSet && !uniqueProblemSets.some((problemSet) => String(problemSet.id) === String(currentSet.id))) {
        uniqueProblemSets.push(currentSet);
      }
      const selectedIds = new Set(
        [...panel.querySelectorAll<HTMLInputElement>('[data-review-set]:checked')].map((input) => input.value)
      );
      const selectedCurrentSetId = state.problemSetId || currentSetId;
      if (selectedCurrentSetId) selectedIds.add(String(selectedCurrentSetId));
      state.reviewProblemSets = uniqueProblemSets;
      const list = requiredElement(panel, '[data-review-sets]');
      list.replaceChildren();
      uniqueProblemSets.forEach((problemSet) => {
        const label = document.createElement('label');
        const isCurrent = String(problemSet.id) === String(state.problemSetId);
        if (isCurrent || problemSet.isCurrentOnly) label.dataset.currentProblemSet = '';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = String(problemSet.id);
        checkbox.dataset.reviewSet = '';
        checkbox.disabled = !problemSet.examId;
        checkbox.checked = selectedIds.has(String(problemSet.id)) && !checkbox.disabled;
        const text = document.createElement('span');
        text.textContent = `${problemSet.name || '未命名作业'}${isCurrent ? '（当前）' : ''}${problemSet.examId ? '' : '（缺少考试 ID）'}`;
        label.append(checkbox, text);
        list.appendChild(label);
      });
      updateReviewDelayVisibility(panel);
      requiredElement(panel, '[data-review-count]').textContent = `已加载 ${uniqueProblemSets.length} 套题目集`;
      if (!automatic) {
        setStatus(panel, '题目集列表已加载');
        setLog(panel, `找到 ${uniqueProblemSets.length} 套题目集；没有考试 ID 的题目集无法导出。`);
      }
    } catch (error) {
      requiredElement(panel, '[data-review-count]').textContent = '加载失败，请重试';
      throw error;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      requiredElement(button, '[data-loader-label]').textContent = '加载题目集';
    }
  }

  return {
    reviewProblemSetInterval,
    problemDetailRequestDelay,
    exportSelectedReviewSets,
    exportSelectedReviewAnswers,
    exportSelectedQuestionBanks,
    updateReviewDelayVisibility,
    loadReviewProblemSets
  };
}
