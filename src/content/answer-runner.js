(() => {
  const supportedTypes = ['PROGRAMMING', 'SQL_PROGRAMMING', 'MULTIPLE_CHOICE', 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER', 'TRUE_OR_FALSE', 'FILL_IN_THE_BLANK', 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'];
  const saveDelayMs = 500;
  const typingDelayMs = 8;
  let focusedEditor = null;
  let focusedEditorSelection = null;
  const observedDocuments = new WeakSet();
  const isProgrammingType = (type) => type === 'PROGRAMMING' || type === 'SQL_PROGRAMMING';

  function editableElement(element) {
    if (element?.nodeType !== Node.ELEMENT_NODE
      || element.closest('#pintia-assistant-panel')
      || element.closest('[contenteditable="false"]')) return null;
    if (element.isContentEditable) return element;
    if (element.matches('textarea, input[type="text"], input:not([type])')) return element;
    return null;
  }

  function selectionEditor(ownerDocument) {
    const selection = ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    return editableElement(anchorElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')
      || anchorElement);
  }

  function observeDocument(ownerDocument) {
    if (observedDocuments.has(ownerDocument)) return;
    observedDocuments.add(ownerDocument);
    ownerDocument.addEventListener('focusin', () => rememberFocusedEditor(ownerDocument), true);
    ownerDocument.addEventListener('selectionchange', () => rememberFocusedEditor(ownerDocument), true);
    for (const eventName of ['click', 'keyup', 'pointerup', 'select', 'input']) {
      ownerDocument.addEventListener(eventName, (event) => {
        if (editableElement(event.target)) rememberFocusedEditor(ownerDocument);
      }, true);
    }
    ownerDocument.defaultView?.addEventListener(
      'focus',
      () => rememberFocusedEditor(ownerDocument),
      true
    );
  }

  function deepestActiveElement(ownerDocument = document) {
    let activeElement = ownerDocument.activeElement;
    while (activeElement?.tagName === 'IFRAME') {
      try {
        ownerDocument = activeElement.contentDocument;
        if (ownerDocument) observeDocument(ownerDocument);
        activeElement = ownerDocument?.activeElement;
      } catch (_) {
        return null;
      }
    }
    return activeElement;
  }

  function selectionFor(element) {
    if (typeof element.selectionStart === 'number') {
      return {
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection || 'none'
      };
    }
    const selection = element.ownerDocument.getSelection();
    if (selection?.rangeCount && element.contains(selection.anchorNode)) {
      return { range: selection.getRangeAt(0).cloneRange() };
    }
    return null;
  }

  function rememberFocusedEditor(ownerDocument = document) {
    const activeElement = deepestActiveElement(ownerDocument);
    const editor = editableElement(activeElement) || selectionEditor(ownerDocument);
    if (!editor) return;
    focusedEditor = editor;
    focusedEditorSelection = selectionFor(editor);
  }

  observeDocument(document);
  rememberFocusedEditor();

  const AnswerParser = {
    parse(text, expectedProblemSetId) {
      return window.PintiaAnswerContract.parse(text, expectedProblemSetId);
    }
  };

  const QuestionResolver = {
    resolve(problemId) {
      const root = document.getElementById(problemId);
      return root
        ? { success: true, root }
        : { success: false, reason: 'question container not found' };
    }
  };

  function problemIdFromLocation(items) {
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

  function resolveQuestion(item, allowSingleEditorFallback = false) {
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

  const typeNavigationIds = {
    MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
    TRUE_OR_FALSE: 'TRUE_OR_FALSE',
    FILL_IN_THE_BLANK: 'FILL_IN_THE_BLANK',
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
  };

  const QuestionTypeNavigator = {
    async navigate(type, items) {
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
        return { success: false, reason: `question type navigation failed: ${error.message || navigationId}` };
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

  function radioFor(problemId, option, root) {
    const input = document.getElementById(`input-radio-option-${problemId}-${option}`);
    return input?.type === 'radio' && input.name === problemId && root.contains(input) ? input : null;
  }

  const SingleChoiceInjector = {
    inject(item, root) {
      const input = radioFor(item.problemId, item.answer, root);
      if (!input) return { success: false, reason: 'target radio option not found' };
      const changed = !input.checked;
      if (changed) input.click();
      return input.checked
        ? { success: true, action: changed ? 'updated' : 'unchanged' }
        : { success: false, reason: 'radio option did not become checked' };
    }
  };

  const MultipleChoiceInjector = {
    inject(item, root) {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((input) => input.name === item.problemId
          && input.id.startsWith(`input-checkbox-option-${item.problemId}-`));
      const desiredAnswers = new Set(item.answer);
      const availableOptions = new Set(inputs.map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length)));
      const missingOption = item.answer.find((option) => !availableOptions.has(option));
      if (missingOption) return { success: false, reason: `checkbox option not found: ${missingOption}` };

      const optionActions = [];
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

  const TrueFalseInjector = {
    inject(item, root) {
      return SingleChoiceInjector.inject({
        ...item,
        answer: item.answer ? 'TRUE' : 'FALSE'
      }, root);
    }
  };

  function blankInput(root, index) {
    const matches = [...root.querySelectorAll('[data-blank-index]')]
      .filter((element) => element.getAttribute('data-blank-index') === String(index));
    if (matches.length !== 1) return null;
    const blank = matches[0];
    if (blank.matches('input, textarea')) return blank;
    return blank.querySelector('input, textarea');
  }

  function programmingBlankInputs(root) {
    return [...root.querySelectorAll('.cm-content input:not([type]), .cm-content input[type="text"], .cm-content textarea')];
  }

  function setInputValue(input, value) {
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

  function dispatchInput(element, character) {
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

  function setNativeValue(element, value) {
    let prototype = element;
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function belongsToQuestion(element, root) {
    let current = element;
    while (current) {
      if (root.contains(current)) return true;
      current = current.ownerDocument?.defaultView?.frameElement || null;
    }
    return false;
  }

  function programmingEditorFor(root) {
    const editorContainer = root.matches('[data-e2e="code-editor-input"]')
      ? root
      : root.querySelector('[data-e2e="code-editor-input"]');
    const editor = editorContainer?.querySelector(
      '.cm-content[contenteditable="true"], textarea, input[type="text"]'
    );
    if (editor) return editor;
    return focusedEditor?.isConnected && belongsToQuestion(focusedEditor, root)
      ? focusedEditor
      : null;
  }

  function insertIntoTextControl(element, character) {
    const selection = focusedEditor === element ? focusedEditorSelection : selectionFor(element);
    const start = selection?.start ?? element.selectionStart ?? element.value.length;
    const end = selection?.end ?? element.selectionEnd ?? start;
    setNativeValue(element, `${element.value.slice(0, start)}${character}${element.value.slice(end)}`);
    const caret = start + character.length;
    element.setSelectionRange(caret, caret);
    focusedEditorSelection = { start: caret, end: caret, direction: 'none' };
    dispatchInput(element, character);
  }

  function insertIntoContentEditable(element, character) {
    const selection = element.ownerDocument.getSelection();
    const rememberedRange = focusedEditor === element
      ? focusedEditorSelection?.range
      : selectionFor(element)?.range;
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

  const ProgrammingInjector = {
    async inject(item, root) {
      const editor = programmingEditorFor(root);
      if (!editor || !editor.isConnected || editor.disabled || editor.readOnly) {
        return { success: false, reason: 'programming editor not found in the target question' };
      }
      if (!belongsToQuestion(editor, root)) {
        return { success: false, skipped: true, reason: 'programming editor is outside the target question' };
      }

      let typedCharacters = 0;
      try {
        for (const character of item.answer) {
          if (!editor.isConnected) throw new Error('programming editor was removed while typing');
          if (typeof editor.value === 'string') insertIntoTextControl(editor, character);
          else insertIntoContentEditable(editor, character);
          typedCharacters += 1;
          await new Promise((resolve) => window.setTimeout(resolve, typingDelayMs));
        }
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        return {
          success: false,
          reason: error.message || 'programming answer typing failed',
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

  const FillBlankInjector = {
    inject(item, root) {
      const inputs = item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
        ? programmingBlankInputs(root)
        : item.answer.map((_, index) => blankInput(root, index));
      if (item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
        && (!inputs.length || inputs.length !== item.answer.length)) {
        return {
          success: false,
          reason: `programming blank input count mismatch: expected ${item.answer.length}, found ${inputs.length}`
        };
      }
      const blankActions = [];
      const action = () => blankActions.some(({ action: blankAction }) => blankAction === 'updated')
        ? 'updated'
        : 'unchanged';
      for (let index = 0; index < item.answer.length; index += 1) {
        const input = inputs[index];
        if (!input) {
          return {
            success: false,
            reason: `blank input not found: ${index}`,
            action: action(),
            blankActions
          };
        }
        const changed = input.value !== item.answer[index];
        if (changed) setInputValue(input, item.answer[index]);
        blankActions.push({ index, action: changed ? 'updated' : 'unchanged' });
        if (input.value !== item.answer[index]) {
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

  function checkedRadio(item, root) {
    const input = radioFor(item.problemId, item.type === 'TRUE_OR_FALSE'
      ? (item.answer ? 'TRUE' : 'FALSE')
      : item.answer, root);
    return Boolean(input?.checked);
  }

  const AnswerVerifier = {
    verify(item, root, injected) {
      if (isProgrammingType(item.type)) {
        const typedCharacters = [...item.answer].length;
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
        const actual = new Set([...root.querySelectorAll('input[type="checkbox"]')]
          .filter((input) => input.name === item.problemId
            && input.id.startsWith(`input-checkbox-option-${item.problemId}-`)
            && input.checked)
          .map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length)));
        const desired = new Set(item.answer);
        const matches = actual.size === desired.size && [...desired].every((option) => actual.has(option));
        return matches
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      if (item.type === 'FILL_IN_THE_BLANK' || item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
        const inputs = item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING'
          ? programmingBlankInputs(root)
          : item.answer.map((_, index) => blankInput(root, index));
        const matches = inputs.length === item.answer.length
          && item.answer.every((value, index) => inputs[index]?.value === value);
        return matches
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      return { success: false, reason: 'unsupported question type' };
    }
  };

  const SaveManager = {
    async save() {
      const button = document.querySelector('button[data-e2e="problem-set-bottom-submit-btn"]');
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
        return { success: false, reason: `save failed: ${error.message || 'button click failed'}` };
      }
    }
  };

  function currentAnswer(item, root) {
    if (item.type === 'MULTIPLE_CHOICE' || item.type === 'TRUE_OR_FALSE') {
      const input = [...root.querySelectorAll('input[type="radio"]')]
        .find((candidate) => candidate.name === item.problemId
          && candidate.checked
          && candidate.id.startsWith(`input-radio-option-${item.problemId}-`));
      return input
        ? input.id.slice(`input-radio-option-${item.problemId}-`.length)
        : null;
    }
    if (item.type === 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER') {
      return [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((input) => input.name === item.problemId
          && input.id.startsWith(`input-checkbox-option-${item.problemId}-`)
          && input.checked)
        .map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length));
    }
    if (item.type === 'FILL_IN_THE_BLANK') {
      return item.answer.map((_, index) => blankInput(root, index)?.value ?? null);
    }
    if (item.type === 'FILL_IN_THE_BLANK_FOR_PROGRAMMING') {
      return programmingBlankInputs(root).map((input) => input.value);
    }
    return null;
  }

  const injectors = {
    PROGRAMMING: ProgrammingInjector,
    SQL_PROGRAMMING: ProgrammingInjector,
    MULTIPLE_CHOICE: SingleChoiceInjector,
    MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: MultipleChoiceInjector,
    TRUE_OR_FALSE: TrueFalseInjector,
    FILL_IN_THE_BLANK: FillBlankInjector,
    FILL_IN_THE_BLANK_FOR_PROGRAMMING: FillBlankInjector
  };

  function requiresBatchSave(payload, allowedTypes) {
    const selectedTypes = new Set(allowedTypes);
    return supportedTypes.filter((type) => selectedTypes.has(type)
      && payload.answers.some((item) => item.type === type)).length > 1;
  }

  const TaskRunner = {
    async run(payload, allowedTypes = supportedTypes, options = {}) {
      const selectedTypes = new Set(allowedTypes);
      const answers = payload.answers.filter((item) => selectedTypes.has(item.type));
      const forcedBatchSave = requiresBatchSave(payload, allowedTypes);
      const saveRequested = options.save !== false || forcedBatchSave;
      const results = new Array(answers.length);
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
              reason: navigation.reason
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
              reason: error.message || 'answer injection failed'
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
            if (forcedBatchSave) {
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

      const summary = {
        total: results.length,
        success: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success && !result.skipped).length,
        skipped: results.filter((result) => result.skipped).length
      };
      return {
        success: summary.total > 0 && summary.failed === 0 && summary.skipped === 0,
        problemSetId: payload.problemSetId,
        saveRequested,
        saved,
        summary,
        results
      };
    }
  };

  window.PintiaAnswerRunner = {
    parse: AnswerParser.parse,
    requiresBatchSave,
    run: TaskRunner.run
  };
})();