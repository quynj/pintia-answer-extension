(() => {
  const supportedTypes = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank'];
  const saveDelayMs = 500;

  const AnswerValidator = {
    validate(payload, expectedProblemSetId) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('答案必须是 JSON 对象。');
      }
      if (payload.problemSetId !== null && typeof payload.problemSetId !== 'string') {
        throw new Error('problemSetId 必须是字符串或 null。');
      }
      if (expectedProblemSetId && payload.problemSetId && payload.problemSetId !== expectedProblemSetId) {
        throw new Error('答案中的 problemSetId 与当前题集不匹配。');
      }
      if (!Array.isArray(payload.answers)) throw new Error('answers 必须是数组。');

      const seenProblemIds = new Set();
      payload.answers.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`answers[${index}] 必须是对象。`);
        }
        if (typeof item.problemId !== 'string' || !item.problemId.trim()) {
          throw new Error(`answers[${index}].problemId 必须是非空字符串。`);
        }
        if (seenProblemIds.has(item.problemId)) {
          throw new Error(`problemId 重复：${item.problemId}`);
        }
        seenProblemIds.add(item.problemId);
        if (typeof item.type !== 'string' || !item.type) {
          throw new Error(`answers[${index}].type 必须是非空字符串。`);
        }
        if (item.questionNumber !== null && typeof item.questionNumber !== 'number') {
          throw new Error(`answers[${index}].questionNumber 必须是数字或 null。`);
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'answer')) {
          throw new Error(`answers[${index}] 缺少 answer。`);
        }

        if (item.type === 'single_choice' && (typeof item.answer !== 'string' || !item.answer)) {
          throw new Error(`题目 ${item.questionNumber ?? index + 1} 的单选答案必须是非空字符串。`);
        }
        if (item.type === 'multiple_choice' && (!Array.isArray(item.answer)
          || item.answer.some((option) => typeof option !== 'string' || !option)
          || new Set(item.answer).size !== item.answer.length)) {
          throw new Error(`题目 ${item.questionNumber ?? index + 1} 的多选答案必须是无重复字符串数组。`);
        }
        if (item.type === 'true_false' && typeof item.answer !== 'boolean') {
          throw new Error(`题目 ${item.questionNumber ?? index + 1} 的判断答案必须是布尔值。`);
        }
        if (item.type === 'fill_blank' && (!Array.isArray(item.answer)
          || item.answer.some((value) => typeof value !== 'string'))) {
          throw new Error(`题目 ${item.questionNumber ?? index + 1} 的填空答案必须是字符串数组。`);
        }
      });
      return payload;
    }
  };

  const AnswerParser = {
    parse(text, expectedProblemSetId) {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error('JSON 格式无效，请检查答案文本。');
      }
      return AnswerValidator.validate(payload, expectedProblemSetId);
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
      if (!input.checked) input.click();
      return input.checked
        ? { success: true }
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

      inputs.forEach((input) => {
        const option = input.id.slice(`input-checkbox-option-${item.problemId}-`.length);
        const shouldBeChecked = desiredAnswers.has(option);
        if (input.checked !== shouldBeChecked) input.click();
      });
      return { success: true };
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
      for (let index = 0; index < item.answer.length; index += 1) {
        const input = blankInput(root, index);
        if (!input) return { success: false, reason: `blank input not found: ${index}` };
        setInputValue(input, item.answer[index]);
        if (input.value !== item.answer[index]) return { success: false, reason: `blank value did not update: ${index}` };
      }
      return { success: true };
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

  const injectors = {
    single_choice: SingleChoiceInjector,
    multiple_choice: MultipleChoiceInjector,
    true_false: TrueFalseInjector,
    fill_blank: FillBlankInjector
  };

  const TaskRunner = {
    async run(payload, allowedTypes = supportedTypes) {
      const results = new Array(payload.answers.length);
      const selectedTypes = new Set(allowedTypes);
      payload.answers.forEach((item, index) => {
        if (!injectors[item.type]) {
          results[index] = {
            questionNumber: item.questionNumber,
            problemId: item.problemId,
            type: item.type,
            success: false,
            skipped: true,
            reason: 'unsupported question type'
          };
        } else if (!selectedTypes.has(item.type)) {
          results[index] = {
            questionNumber: item.questionNumber,
            problemId: item.problemId,
            type: item.type,
            success: false,
            skipped: true,
            reason: 'question type not selected'
          };
        }
      });

      for (const type of supportedTypes) {
        const batch = payload.answers
          .map((item, index) => ({ item, index }))
          .filter(({ item, index }) => item.type === type && selectedTypes.has(type) && !results[index]);
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
            const injected = injectors[type].inject(item, question.root);
            if (!injected.success) {
              results[index] = { questionNumber: item.questionNumber, problemId: item.problemId, type, success: false, reason: injected.reason };
              continue;
            }
            const verification = AnswerVerifier.verify(item, question.root);
            results[index] = verification.success
              ? { questionNumber: item.questionNumber, problemId: item.problemId, type, success: true }
              : { questionNumber: item.questionNumber, problemId: item.problemId, type, success: false, reason: verification.reason };
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

        if (batchHasVerifiedAnswer) {
          const saveResult = await SaveManager.save();
          if (!saveResult.success) {
            batch.forEach(({ index }) => {
              if (results[index]?.success) {
                results[index] = { ...results[index], success: false, reason: saveResult.reason };
              }
            });
          }
        }
      }

      payload.answers.forEach((item, index) => {
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
        success: summary.failed === 0 && summary.skipped === 0,
        problemSetId: payload.problemSetId,
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