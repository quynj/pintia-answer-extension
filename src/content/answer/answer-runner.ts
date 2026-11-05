import { answerContract } from '../../shared/answer-contract';
import type {
  AnswerRunReport,
  JsonValue,
  PintiaAnswerItem,
  PintiaAnswerPayload,
  PintiaAnswerRunnerApi
} from '../../shared/types';

type TextControl = HTMLInputElement | HTMLTextAreaElement;
type EditorElement = TextControl | (HTMLElement & { isContentEditable: true });
type EditorSelection =
  | { start: number; end: number; direction: 'forward' | 'backward' | 'none' }
  | { range: Range };
type InjectionResult = {
  success: boolean;
  reason?: string;
  skipped?: boolean;
  action?: string;
  typedCharacters?: number;
  optionActions?: Array<{ option: string; action: string }>;
  blankActions?: Array<{ index: number; action: string }>;
};
type AnswerInjector = {
  inject(item: PintiaAnswerItem, root: Element): InjectionResult | Promise<InjectionResult>;
};
type QuestionResolution =
  | { success: true; root: Element }
  | { success: false; reason: string };
type InternalAnswerRunResult = Record<string, unknown> & { success: boolean; skipped?: boolean };

  const supportedTypes = ['PROGRAMMING', 'SQL_PROGRAMMING', 'MULTIPLE_CHOICE', 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER', 'TRUE_OR_FALSE', 'FILL_IN_THE_BLANK', 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'];
  const saveDelayMs = 500;
  const typingDelayMs = 8;
  let focusedEditor: EditorElement | null = null;
  let focusedEditorSelection: EditorSelection | null = null;
  const observedDocuments = new WeakSet<Document>();
  const isProgrammingType = (type: string): boolean => type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING';
  const programmingAnswerText = (item: PintiaAnswerItem): string => stringAnswer(item).replace(/\r\n?/g, '\n');

  function isEditorElement(element: Element | null): element is EditorElement {
    return element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || (element instanceof HTMLElement && element.isContentEditable);
  }

  function editableElement(element: Element | null): EditorElement | null {
    if (element?.nodeType !== Node.ELEMENT_NODE
      || element.closest('#pintia-assistant-panel')
      || element.closest('[contenteditable="false"]')) return null;
    if (element instanceof HTMLElement && element.isContentEditable) {
      return element as HTMLElement & { isContentEditable: true };
    }
    if (element instanceof HTMLInputElement && element.matches('input[type="text"], input:not([type])')) return element;
    if (element instanceof HTMLTextAreaElement) return element;
    return null;
  }

  function selectionEditor(ownerDocument: Document): EditorElement | null {
    const selection = ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
    return editableElement(anchorElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')
      || anchorElement);
  }

  function observeDocument(ownerDocument: Document): void {
    if (observedDocuments.has(ownerDocument)) return;
    observedDocuments.add(ownerDocument);
    ownerDocument.addEventListener('focusin', () => rememberFocusedEditor(ownerDocument), true);
    ownerDocument.addEventListener('selectionchange', () => rememberFocusedEditor(ownerDocument), true);
    for (const eventName of ['click', 'keyup', 'pointerup', 'select', 'input']) {
      ownerDocument.addEventListener(eventName, (event: Event) => {
        if (event.target instanceof Element && editableElement(event.target)) rememberFocusedEditor(ownerDocument);
      }, true);
    }
    ownerDocument.defaultView?.addEventListener(
      'focus',
      () => rememberFocusedEditor(ownerDocument),
      true
    );
  }

  function deepestActiveElement(ownerDocument: Document = document): Element | null {
    let activeElement = ownerDocument.activeElement;
    while (activeElement instanceof HTMLIFrameElement) {
      try {
        const frameDocument = activeElement.contentDocument;
        if (!frameDocument) return null;
        ownerDocument = frameDocument;
        observeDocument(ownerDocument);
        activeElement = ownerDocument.activeElement;
      } catch (_) {
        return null;
      }
    }
    return activeElement;
  }

  function selectionFor(element: EditorElement): EditorSelection | null {
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
      && typeof element.selectionStart === 'number') {
      return {
        start: element.selectionStart,
        end: element.selectionEnd ?? element.selectionStart,
        direction: element.selectionDirection || 'none'
      };
    }
    const selection = element.ownerDocument.getSelection();
    if (selection?.rangeCount && element.contains(selection.anchorNode)) {
      return { range: selection.getRangeAt(0).cloneRange() };
    }
    return null;
  }

  function rememberFocusedEditor(ownerDocument: Document = document): void {
    const activeElement = deepestActiveElement(ownerDocument);
    const editor = editableElement(activeElement) || selectionEditor(ownerDocument);
    if (!editor) return;
    focusedEditor = editor;
    focusedEditorSelection = selectionFor(editor);
  }

  observeDocument(document);
  rememberFocusedEditor();

  const AnswerParser = {
    parse(text: string, expectedProblemSetId?: string | null): PintiaAnswerPayload {
      return answerContract.parse(text, expectedProblemSetId);
    }
  };

  const QuestionResolver = {
    resolve(problemId: string): QuestionResolution {
      const root = document.getElementById(problemId);
      return root
        ? { success: true, root }
        : { success: false, reason: 'question container not found' };
    }
  };

  function problemIdFromLocation(items: PintiaAnswerItem[]): string | null {
    const pathSegments = location.pathname.split('/').filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (_) {
        return segment;
      }
    });
    const queryValues = [...new URLSearchParams(location.search).values()];
    const matches = items.filter(({ problemId }) => pathSegments.includes(problemId)
      || queryValues.includes(problemId));
    return matches.length === 1 ? matches[0].problemId : null;
  }

  function resolveQuestion(item: PintiaAnswerItem, allowSingleEditorFallback = false): QuestionResolution {
    const question = QuestionResolver.resolve(item.problemId);
    if (!isProgrammingType(item.type)) return question;
    if (question.success && (question.root.matches('[data-e2e="code-editor-input"]')
      || question.root.querySelector('[data-e2e="code-editor-input"]'))) {
      return question;
    }
    if (!allowSingleEditorFallback) return question;
    const visibleEditors = [...document.querySelectorAll('[data-e2e="code-editor-input"]')]
      .filter((editor) => editor.getClientRects().length > 0);
    return visibleEditors.length === 1
      ? { success: true, root: visibleEditors[0] }
      : { success: false, reason: 'question container not found and no unique visible code editor is available' };
  }

  const typeNavigationIds: Record<string, string> = {
    MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
    TRUE_OR_FALSE: 'TRUE_OR_FALSE',
    FILL_IN_THE_BLANK: 'FILL_IN_THE_BLANK',
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
  };

  const QuestionTypeNavigator = {
    async navigate(type: string, items: PintiaAnswerItem[]): Promise<{ success: boolean; reason?: string }> {
      const hasQuestion = () => items.some((item) => {
        const question = document.getElementById(item.problemId);
        return question && question.getClientRects().length > 0;
      });
      if (hasQuestion()) return { success: true };

      const navigationId = typeNavigationIds[type];
      if (!navigationId) return { success: false, reason: `navigation id not configured for type: ${type}` };
      const control = document.getElementById(navigationId);
      if (!control || control.tagName !== 'A' || control.getClientRects().length === 0) {
        return { success: false, reason: `question type navigation not found: ${navigationId}` };
      }
      try {
        control.click();
      } catch (error) {
        return {
          success: false,
          reason: `question type navigation failed: ${error instanceof Error ? error.message : navigationId}`
        };
      }

      const deadline = Date.now() + 5000;
      while (!hasQuestion() && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      return hasQuestion()
        ? { success: true }
        : { success: false, reason: `questions did not load after switching to ${navigationId}` };
    }
  };

  function radioFor(problemId: string, option: string, root: Element): HTMLInputElement | null {
    const input = document.getElementById(`input-radio-option-${problemId}-${option}`);
    return input instanceof HTMLInputElement
      && input.type === 'radio'
      && input.name === problemId
      && root.contains(input)
      ? input
      : null;
  }

  function stringAnswer(item: PintiaAnswerItem): string {
    if (typeof item.answer !== 'string') throw new Error('answer must be a string');
    return item.answer;
  }

  function stringArrayAnswer(item: PintiaAnswerItem): string[] {
    if (!Array.isArray(item.answer) || !item.answer.every((value) => typeof value === 'string')) {
      throw new Error('answer must be an array of strings');
    }
    return item.answer;
  }

  function booleanAnswer(item: PintiaAnswerItem): boolean {
    if (typeof item.answer !== 'boolean') throw new Error('answer must be a boolean');
    return item.answer;
  }

  const SingleChoiceInjector: AnswerInjector = {
    inject(item, root) {
      const input = radioFor(item.problemId, stringAnswer(item), root);
      if (!input) return { success: false, reason: 'target radio option not found' };
      const changed = !input.checked;
      if (changed) input.click();
      return input.checked
        ? { success: true, action: changed ? 'updated' : 'unchanged' }
        : { success: false, reason: 'radio option did not become checked' };
    }
  };

  const MultipleChoiceInjector: AnswerInjector = {
    inject(item, root) {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
        .filter((input) => input.name === item.problemId
          && input.id.startsWith(`input-checkbox-option-${item.problemId}-`));
      const answers = stringArrayAnswer(item);
      const desiredAnswers = new Set(answers);
      const availableOptions = new Set(inputs.map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length)));
      const missingOption = answers.find((option) => !availableOptions.has(option));
      if (missingOption) return { success: false, reason: `checkbox option not found: ${missingOption}` };

      const optionActions: Array<{ option: string; action: string }> = [];
      inputs.forEach((input) => {
        const option = input.id.slice(`input-checkbox-option-${item.problemId}-`.length);
        const shouldBeChecked = desiredAnswers.has(option);
        if (input.checked !== shouldBeChecked) {
          input.click();
          optionActions.push({ option, action: shouldBeChecked ? 'checked' : 'unchecked' });
        } else {
          optionActions.push({ option, action: shouldBeChecked ? 'already_checked' : 'already_unchecked' });
        }
      });
      return {
        success: true,
        action: optionActions.some(({ action }) => action === 'checked' || action === 'unchecked') ? 'updated' : 'unchanged',
        optionActions
      };
    }
  };

  const TrueFalseInjector: AnswerInjector = {
    inject(item, root) {
      return SingleChoiceInjector.inject({
        ...item,
        answer: booleanAnswer(item) ? 'TRUE' : 'FALSE'
      }, root);
    }
  };

  function blankInput(root: Element, index: number): TextControl | null {
    const matches = [...root.querySelectorAll('[data-blank-index]')]
      .filter((element) => element.getAttribute('data-blank-index') === String(index));
    if (matches.length !== 1) return null;
    const blank = matches[0];
    if (blank instanceof HTMLInputElement || blank instanceof HTMLTextAreaElement) return blank;
    return blank.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  }

  function programmingBlankInputs(root: Element): TextControl[] {
    return [...root.querySelectorAll('.cm-content input:not([type]), .cm-content input[type="text"], .cm-content textarea')]
      .filter((element): element is TextControl =>
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement);
  }

  function setInputValue(input: TextControl, value: string): void {
    let prototype = input;
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchInput(element: EditorElement, character: string): void {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: character
      }));
    } catch (_) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function setNativeValue(element: TextControl, value: string): void {
    let prototype = element;
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function belongsToQuestion(element: Element, root: Element): boolean {
    let current: Element | null = element;
    while (current) {
      if (root.contains(current)) return true;
      const frameElement: Element | null = current.ownerDocument.defaultView?.frameElement ?? null;
      current = frameElement instanceof Element ? frameElement : null;
    }
    return false;
  }

  function programmingEditorFor(root: Element): EditorElement | null {
    const editorContainer = root.matches('[data-e2e="code-editor-input"]')
      ? root
      : root.querySelector('[data-e2e="code-editor-input"]');
    const editor = editorContainer?.querySelector(
      '.cm-content[contenteditable="true"], textarea, input[type="text"]'
    );
    if (editor && isEditorElement(editor)) return editor;
    return focusedEditor?.isConnected && belongsToQuestion(focusedEditor, root)
      ? focusedEditor
      : null;
  }

  function insertIntoTextControl(element: TextControl, character: string): void {
    const selection = focusedEditor === element ? focusedEditorSelection : selectionFor(element);
    const start = selection && 'start' in selection
      ? selection.start
      : element.selectionStart ?? element.value.length;
    const end = selection && 'end' in selection
      ? selection.end
      : element.selectionEnd ?? start;
    setNativeValue(element, `${element.value.slice(0, start)}${character}${element.value.slice(end)}`);
    const caret = start + character.length;
    element.setSelectionRange(caret, caret);
    focusedEditorSelection = { start: caret, end: caret, direction: 'none' };
    dispatchInput(element, character);
  }

  function insertIntoContentEditable(element: HTMLElement & { isContentEditable: true }, character: string): void {
    const selection = element.ownerDocument.getSelection();
    const rememberedSelection = focusedEditor === element
      ? focusedEditorSelection
      : selectionFor(element);
    const rememberedRange = rememberedSelection && 'range' in rememberedSelection
      ? rememberedSelection.range
      : null;
    const range = rememberedRange?.cloneRange();
    if (!selection || !range || !element.contains(range.startContainer)
      || !element.contains(range.endContainer)) {
      throw new Error('programming editor cursor position is unavailable');
    }
    element.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    if (!element.ownerDocument.execCommand('insertText', false, character)) {
      throw new Error('programming editor rejected text insertion');
    }
    const updatedSelection = element.ownerDocument.getSelection();
    if (updatedSelection?.rangeCount && element.contains(updatedSelection.anchorNode)) {
      focusedEditor = element;
      focusedEditorSelection = { range: updatedSelection.getRangeAt(0).cloneRange() };
    }
  }

  function selectProgrammingEditorContents(editor: EditorElement): void {
    editor.focus({ preventScroll: true });
    focusedEditor = editor;
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      editor.setSelectionRange(0, editor.value.length);
      focusedEditorSelection = { start: 0, end: editor.value.length, direction: 'none' };
      return;
    }
    const selection = editor.ownerDocument.getSelection();
    if (!selection) throw new Error('programming editor selection is unavailable');
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    focusedEditorSelection = { range: range.cloneRange() };
  }

  function programmingEditorValue(editor: EditorElement): string {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) return editor.value;
    const lines = [...editor.querySelectorAll('.cm-line')];
    return lines.length
      ? lines.map((line) => line.textContent || '').join('\n')
      : editor.innerText.replace(/\r\n/g, '\n');
  }

  const ProgrammingInjector: AnswerInjector = {
    async inject(item, root) {
      const editor = programmingEditorFor(root);
      if (!editor || !editor.isConnected
        || ((editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)
          && (editor.disabled || editor.readOnly))) {
        return { success: false, reason: 'programming editor not found in the target question' };
      }
      if (!belongsToQuestion(editor, root)) {
        return { success: false, skipped: true, reason: 'programming editor is outside the target question' };
      }

      let typedCharacters = 0;
      const answer = programmingAnswerText(item);
      try {
        selectProgrammingEditorContents(editor);
        for (const character of answer) {
          if (!editor.isConnected) throw new Error('programming editor was removed while typing');
          if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
            insertIntoTextControl(editor, character);
          } else {
            insertIntoContentEditable(editor, character);
          }
          typedCharacters += 1;
          await new Promise((resolve) => window.setTimeout(resolve, typingDelayMs));
        }
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        if (programmingEditorValue(editor) !== answer) {
          throw new Error('programming editor content did not match answer');
        }
      } catch (error) {
        return {
          success: false,
          reason: error instanceof Error ? error.message : 'programming answer typing failed',
          action: typedCharacters ? 'updated' : 'unchanged',
          typedCharacters
        };
      }
      return {
        success: true,
        action: typedCharacters ? 'updated' : 'unchanged',
        typedCharacters
      };
    }
  };

  const FillBlankInjector: AnswerInjector = {
    inject(item, root) {
      const answers = stringArrayAnswer(item);
      const inputs = item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
        ? programmingBlankInputs(root)
        : answers.map((_answer, index) => blankInput(root, index));
      if (item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
        && (!inputs.length || inputs.length !== answers.length)) {
        return {
          success: false,
          reason: `programming blank input count mismatch: expected ${answers.length}, found ${inputs.length}`
        };
      }
      const blankActions: Array<{ index: number; action: string }> = [];
      const action = () => blankActions.some(({ action: blankAction }) => blankAction === 'updated')
        ? 'updated'
        : 'unchanged';
      for (let index = 0; index < answers.length; index += 1) {
        const input = inputs[index];
        if (!input) {
          return {
            success: false,
            reason: `blank input not found: ${index}`,
            action: action(),
            blankActions
          };
        }
        const changed = input.value !== answers[index];
        if (changed) setInputValue(input, answers[index]);
        blankActions.push({ index, action: changed ? 'updated' : 'unchanged' });
        if (input.value !== answers[index]) {
          return {
            success: false,
            reason: `blank value did not update: ${index}`,
            action: action(),
            blankActions
          };
        }
      }
      return {
        success: true,
        action: action(),
        blankActions
      };
    }
  };

  function checkedRadio(item: PintiaAnswerItem, root: Element): boolean {
    const input = radioFor(item.problemId, item.type === 'TRUE_OR_FALSE'
      ? (booleanAnswer(item) ? 'TRUE' : 'FALSE')
      : stringAnswer(item), root);
    return Boolean(input?.checked);
  }

  const AnswerVerifier = {
    verify(item: PintiaAnswerItem, root: Element, injected?: InjectionResult): { success: boolean; reason?: string } {
      if (isProgrammingType(item.type)) {
        const typedCharacters = [...programmingAnswerText(item)].length;
        return injected?.success && injected.typedCharacters === typedCharacters
          ? { success: true }
          : { success: false, reason: 'programming answer typing verification failed' };
      }
      if (item.type === 'MULTIPLE_CHOICE' || item.type === 'TRUE_OR_FALSE') {
        return checkedRadio(item, root)
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      if (item.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER') {
        const answers = stringArrayAnswer(item);
        const actual = new Set<string>([...root.querySelectorAll('input[type="checkbox"]')]
          .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
          .filter((input) => input.name === item.problemId
            && input.id.startsWith(`input-checkbox-option-${item.problemId}-`)
            && input.checked)
          .map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length)));
        const desired = new Set(answers);
        const matches = actual.size === desired.size && [...desired].every((option) => actual.has(option));
        return matches
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      if (item.type === 'FILL_IN_THE_BLANK' || item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
        const answers = stringArrayAnswer(item);
        const inputs = item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
          ? programmingBlankInputs(root)
          : answers.map((_answer, index) => blankInput(root, index));
        const matches = inputs.length === answers.length
          && answers.every((value, index) => inputs[index]?.value === value);
        return matches
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      return { success: false, reason: 'unsupported question type' };
    }
  };

  const SaveManager = {
    async save() {
      const button = document.querySelector<HTMLButtonElement>('button[data-e2e="problem-set-bottom-submit-btn"]');
      if (!button) return { success: false, reason: 'save button not found' };
      try {
        const previousAlerts = new Set([...document.querySelectorAll('[role="alert"]')]
          .map((alert) => alert.textContent.trim()));
        button.click();
        await new Promise((resolve) => window.setTimeout(resolve, saveDelayMs));
        const errorAlert = [...document.querySelectorAll('[role="alert"]')]
          .map((alert) => alert.textContent.trim())
          .find((text) => text && !previousAlerts.has(text) && /(失败|错误|未保存|error|failed)/i.test(text));
        return errorAlert
          ? { success: false, reason: `save failed: ${errorAlert}` }
          : { success: true };
      } catch (error) {
        return { success: false, reason: `save failed: ${error instanceof Error ? error.message : 'button click failed'}` };
      }
    }
  };

  function currentAnswer(item: PintiaAnswerItem, root: Element): JsonValue | null {
    if (item.type === 'MULTIPLE_CHOICE' || item.type === 'TRUE_OR_FALSE') {
      const input = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((candidate) => candidate.name === item.problemId
          && candidate.checked
          && candidate.id.startsWith(`input-radio-option-${item.problemId}-`));
      return input
        ? input.id.slice(`input-radio-option-${item.problemId}-`.length)
        : null;
    }
    if (item.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER') {
      return [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .filter((input) => input.name === item.problemId
          && input.id.startsWith(`input-checkbox-option-${item.problemId}-`)
          && input.checked)
        .map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length));
    }
    if (item.type === 'FILL_IN_THE_BLANK') {
      return stringArrayAnswer(item).map((_answer, index) => blankInput(root, index)?.value ?? null);
    }
    if (item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
      return programmingBlankInputs(root).map((input) => input.value);
    }
    return null;
  }

  const injectors: Record<string, AnswerInjector> = {
    PROGRAMMING: ProgrammingInjector,
    SQL_PROGRAMMING: ProgrammingInjector,
    MULTIPLE_CHOICE: SingleChoiceInjector,
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: MultipleChoiceInjector,
    TRUE_OR_FALSE: TrueFalseInjector,
    FILL_IN_THE_BLANK: FillBlankInjector,
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: FillBlankInjector
  };

  function requiresBatchSave(payload: PintiaAnswerPayload, allowedTypes: string[]): boolean {
    const selectedTypes = new Set(allowedTypes);
    return supportedTypes.filter((type) => selectedTypes.has(type)
      && payload.answers.some((item) => item.type === type)).length > 1;
  }

  const TaskRunner = {
    async run(
      payload: PintiaAnswerPayload,
      allowedTypes: string[] = supportedTypes,
      options: { save?: boolean } = {}
    ):     Promise<AnswerRunReport> {
      const selectedTypes = new Set(allowedTypes);
      const answers = payload.answers.filter((item) => selectedTypes.has(item.type));
      const forcedBatchSave = requiresBatchSave(payload, allowedTypes);
      const saveRequested = options.save !== false || forcedBatchSave;
      const results: Array<InternalAnswerRunResult | undefined> = new Array(answers.length);
      let saved = false;
      const programmingAnswers = answers.filter((item) => isProgrammingType(item.type));
      const currentPageProblemId = problemIdFromLocation(programmingAnswers);
      if (currentPageProblemId) {
        answers.forEach((item, index) => {
          if (isProgrammingType(item.type) && item.problemId !== currentPageProblemId) {
            results[index] = {
              questionNumber: item.questionNumber,
              problemId: item.problemId,
              type: item.type,
              success: false,
              skipped: true,
              reason: 'programming question is on a different page'
            };
          }
        });
      }

      answers.forEach((item, index) => {
        if (!injectors[item.type]) {
          results[index] = {
            questionNumber: item.questionNumber,
            problemId: item.problemId,
            type: item.type,
            success: false,
            skipped: true,
            reason: 'unsupported question type'
          };
        }
      });

      for (const type of supportedTypes) {
        const batch = answers
          .map((item, index) => ({ item, index }))
          .filter(({ item, index }) => item.type === type && !results[index]);
        if (!batch.length) continue;

        const navigation = isProgrammingType(type)
          ? { success: true }
          : await QuestionTypeNavigator.navigate(type, batch.map(({ item }) => item));
        if (!navigation.success) {
          batch.forEach(({ item, index }) => {
            results[index] = {
              questionNumber: item.questionNumber,
              problemId: item.problemId,
              type,
              success: false,
              reason: navigation.reason || 'question type navigation failed'
            };
          });
          continue;
        }

        let batchHasVerifiedAnswer = false;

        for (const { item, index } of batch) {
          try {
            const question = resolveQuestion(item, isProgrammingType(type) && batch.length === 1);
            if (!question.success) {
              results[index] = {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: false,
                reason: question.reason
              };
              continue;
            }
            const answerContext = {
              ...(isProgrammingType(type) ? {} : { previousAnswer: currentAnswer(item, question.root) }),
              targetAnswer: Array.isArray(item.answer) ? [...item.answer] : item.answer
            };
            const injected = await injectors[type].inject(item, question.root);
            if (!injected.success) {
              results[index] = {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: false,
                ...(injected.skipped ? { skipped: true } : {}),
                reason: injected.reason,
                ...answerContext,
                ...(injected.action ? { action: injected.action } : {}),
                ...(injected.typedCharacters !== undefined ? { typedCharacters: injected.typedCharacters } : {}),
                ...(injected.optionActions ? { optionActions: injected.optionActions } : {}),
                ...(injected.blankActions ? { blankActions: injected.blankActions } : {})
              };
              continue;
            }
            const verification = AnswerVerifier.verify(item, question.root, injected);
            results[index] = verification.success
              ? {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: true,
                ...answerContext,
                action: injected.action,
                ...(injected.typedCharacters !== undefined ? { typedCharacters: injected.typedCharacters } : {}),
                ...(injected.optionActions ? { optionActions: injected.optionActions } : {}),
                ...(injected.blankActions ? { blankActions: injected.blankActions } : {})
              }
              : {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: false,
                reason: verification.reason,
                ...answerContext,
                action: injected.action,
                ...(injected.optionActions ? { optionActions: injected.optionActions } : {}),
                ...(injected.blankActions ? { blankActions: injected.blankActions } : {})
              };
            if (verification.success) batchHasVerifiedAnswer = true;
          } catch (error) {
            results[index] = {
              questionNumber: item.questionNumber,
              problemId: item.problemId,
              type,
              success: false,
              reason: error instanceof Error ? error.message : 'answer injection failed'
            };
          }
        }

        if (batchHasVerifiedAnswer && saveRequested) {
          const saveResult = await SaveManager.save();
          if (saveResult.success) saved = true;
          if (!saveResult.success) {
            batch.forEach(({ index }) => {
              if (results[index]?.success) {
                results[index] = { ...results[index], success: false, reason: saveResult.reason };
              }
            });
            if (saveRequested) {
              const remainingTypes = new Set(supportedTypes.slice(supportedTypes.indexOf(type) + 1));
              for (const { item, index } of answers
                .map((item, index) => ({ item, index }))
                .filter(({ item, index }) => remainingTypes.has(item.type) && !results[index])) {
                results[index] = {
                  questionNumber: item.questionNumber,
                  problemId: item.problemId,
                  type: item.type,
                  success: false,
                  reason: 'stopped because the previous question type batch could not be saved'
                };
              }
              break;
            }
          }
        }
      }

      answers.forEach((item, index) => {
        if (results[index]) return;
        results[index] = {
          questionNumber: item.questionNumber,
          problemId: item.problemId,
          type: item.type,
          success: false,
          skipped: true,
          reason: 'unsupported question type'
        };
      });

      const completedResults = results.filter(
        (result): result is InternalAnswerRunResult => result !== undefined
      );
      const summary = {
        total: completedResults.length,
        success: completedResults.filter((result) => result.success).length,
        failed: completedResults.filter((result) => !result.success && !result.skipped).length,
        skipped: completedResults.filter((result) => result.skipped).length
      };
      return {
        success: summary.total > 0 && summary.failed === 0 && summary.skipped === 0,
        problemSetId: payload.problemSetId,
        saveRequested,
        saved,
        summary,
        results: completedResults
      };
    }
  };

export const answerRunner: PintiaAnswerRunnerApi = {
    parse: AnswerParser.parse,
    requiresBatchSave,
    run: TaskRunner.run
};