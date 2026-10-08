(() => {
  const supportedTypes = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank'];
  const saveDelayMs = 500;

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

  const typeNavigationIds = {
    single_choice: 'MULTIPLE_CHOICE',
    multiple_choice: 'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
    true_false: 'TRUE_OR_FALSE',
    fill_blank: 'FILL_IN_THE_BLANK'
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

  const FillBlankInjector = {
    inject(item, root) {
      const blankActions = [];
      const action = () => blankActions.some(({ action: blankAction }) => blankAction === 'updated')
        ? 'updated'
        : 'unchanged';
      for (let index = 0; index < item.answer.length; index += 1) {
        const input = blankInput(root, index);
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
    const input = radioFor(item.problemId, item.type === 'true_false'
      ? (item.answer ? 'TRUE' : 'FALSE')
      : item.answer, root);
    return Boolean(input?.checked);
  }

  const AnswerVerifier = {
    verify(item, root) {
      if (item.type === 'single_choice' || item.type === 'true_false') {
        return checkedRadio(item, root)
          ? { success: true }
          : { success: false, reason: 'answer verification failed' };
      }
      if (item.type === 'multiple_choice') {
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
      if (item.type === 'fill_blank') {
        const matches = item.answer.every((value, index) => blankInput(root, index)?.value === value);
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
    if (item.type === 'single_choice' || item.type === 'true_false') {
      const input = [...root.querySelectorAll('input[type="radio"]')]
        .find((candidate) => candidate.name === item.problemId
          && candidate.checked
          && candidate.id.startsWith(`input-radio-option-${item.problemId}-`));
      return input
        ? input.id.slice(`input-radio-option-${item.problemId}-`.length)
        : null;
    }
    if (item.type === 'multiple_choice') {
      return [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((input) => input.name === item.problemId
          && input.id.startsWith(`input-checkbox-option-${item.problemId}-`)
          && input.checked)
        .map((input) => input.id.slice(`input-checkbox-option-${item.problemId}-`.length));
    }
    if (item.type === 'fill_blank') {
      return item.answer.map((_, index) => blankInput(root, index)?.value ?? null);
    }
    return null;
  }

  const injectors = {
    single_choice: SingleChoiceInjector,
    multiple_choice: MultipleChoiceInjector,
    true_false: TrueFalseInjector,
    fill_blank: FillBlankInjector
  };

  const TaskRunner = {
    async run(payload, allowedTypes = supportedTypes, options = {}) {
      const selectedTypes = new Set(allowedTypes);
      const answers = payload.answers.filter((item) => selectedTypes.has(item.type));
      const results = new Array(answers.length);
      let saved = false;
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

        const navigation = await QuestionTypeNavigator.navigate(type, batch.map(({ item }) => item));
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
            const question = QuestionResolver.resolve(item.problemId);
            if (!question.success) {
              results[index] = { questionNumber: item.questionNumber, problemId: item.problemId, type, success: false, reason: question.reason };
              continue;
            }
            const previousAnswer = currentAnswer(item, question.root);
            const answerContext = {
              previousAnswer,
              targetAnswer: Array.isArray(item.answer) ? [...item.answer] : item.answer
            };
            const injected = injectors[type].inject(item, question.root);
            if (!injected.success) {
              results[index] = {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: false,
                reason: injected.reason,
                ...answerContext,
                ...(injected.action ? { action: injected.action } : {}),
                ...(injected.optionActions ? { optionActions: injected.optionActions } : {}),
                ...(injected.blankActions ? { blankActions: injected.blankActions } : {})
              };
              continue;
            }
            const verification = AnswerVerifier.verify(item, question.root);
            results[index] = verification.success
              ? {
                questionNumber: item.questionNumber,
                problemId: item.problemId,
                type,
                success: true,
                ...answerContext,
                action: injected.action,
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

        if (batchHasVerifiedAnswer && options.save !== false) {
          const saveResult = await SaveManager.save();
          if (saveResult.success) saved = true;
          if (!saveResult.success) {
            batch.forEach(({ index }) => {
              if (results[index]?.success) {
                results[index] = { ...results[index], success: false, reason: saveResult.reason };
              }
            });
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
        saveRequested: options.save !== false,
        saved,
        summary,
        results
      };
    }
  };

  window.PintiaAnswerRunner = {
    parse: AnswerParser.parse,
    run: TaskRunner.run
  };
})();