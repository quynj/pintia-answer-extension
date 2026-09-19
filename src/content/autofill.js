(() => {
  const api = window.PintiaAutofill = window.PintiaAutofill || {};

  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const visible = (element) => Boolean(element && element.isConnected && element.getClientRects().length);

  function questionRoots() {
    const selectors = [
      '[data-question-number]', '[data-question-id]', '[data-problem-id]',
      '[class*="question" i]', '[class*="problem" i]', 'article', 'li', 'form'
    ];
    return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
      .filter(visible)
      .filter((root) => root.querySelector('input, textarea, [contenteditable="true"], button, label'));
  }

  function locateRoot(answer) {
    const number = String(answer.questionNumber ?? '');
    const roots = questionRoots();
    const numbered = roots.find((root) => {
      const value = root.getAttribute('data-question-number') || root.getAttribute('data-number');
      return value && value === number;
    });
    if (numbered) return numbered;
    const heading = [...document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')]
      .find((element) => new RegExp(`(?:^|\\D)${number}(?:\\D|$)`).test(text(element.textContent)));
    if (heading) return heading.closest('[data-question-number], [data-question-id], article, li, form, section, div') || heading.parentElement;
    return roots.length === 1 ? roots[0] : null;
  }

  function choiceKey(element) {
    const input = element.matches('input') ? element : element.querySelector('input');
    const label = element.matches('label') ? element : element.closest('label');
    const value = input?.value || element.getAttribute('data-value') || element.textContent || label?.textContent;
    const match = text(value).match(/(?:^|\s|[.、)])([A-Z])(?:\s|[.、)]|$)/i);
    return (match?.[1] || text(value)).toUpperCase();
  }

  function choiceTarget(root, answer) {
    const expected = text(answer).toUpperCase();
    return [...root.querySelectorAll('label, input[type="radio"], input[type="checkbox"], button, [role="radio"], [role="checkbox"]')]
      .filter(visible)
      .find((element) => {
        const key = choiceKey(element);
        if (key === expected) return true;
        const labelText = text(element.textContent).toLowerCase();
        if (expected === 'TRUE') return labelText.includes('正确') || labelText.includes('对') || labelText === 'true';
        if (expected === 'FALSE') return labelText.includes('错误') || labelText.includes('错') || labelText === 'false';
        return false;
      });
  }

  function clickTarget(target) {
    const input = target.matches('input') ? target : target.querySelector('input');
    const clickable = target.matches('label, button, [role="radio"], [role="checkbox"]') ? target : input;
    if (!clickable) return false;
    clickable.focus?.();
    clickable.click();
    if (input && !input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function setValue(element, value) {
    const nextValue = String(value ?? '');
    element.focus?.();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, nextValue);
    else element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur?.();
  }

  function editableTargets(root) {
    return [...root.querySelectorAll('textarea, input:not([type]), input[type="text"], input[type="number"], [contenteditable="true"]')]
      .filter(visible);
  }

  function fillChoice(root, answer, multiple = false) {
    const values = Array.isArray(answer) ? answer : [answer];
    if (!multiple && values.length !== 1) return false;
    return values.every((value) => {
      const target = choiceTarget(root, value);
      return target ? clickTarget(target) : false;
    });
  }

  function fillText(root, answer) {
    const values = Array.isArray(answer) ? answer : [answer];
    const targets = editableTargets(root);
    if (!targets.length) return false;
    values.forEach((value, index) => {
      const target = targets[index];
      if (!target) return;
      if (target.matches('[contenteditable="true"]')) {
        target.focus();
        target.textContent = String(value ?? '');
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value ?? '') }));
        target.blur();
      } else setValue(target, value);
    });
    return values.every((_value, index) => Boolean(targets[index]));
  }

  function verify(root, answer) {
    const type = answer.type;
    if (type === 'single_choice' || type === 'true_false' || type === 'multiple_choice') {
      const values = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
      return values.every((value) => {
        const target = choiceTarget(root, value);
        const input = target?.matches('input') ? target : target?.querySelector('input');
        return Boolean(input?.checked || target?.getAttribute('aria-checked') === 'true' || target?.classList.contains('selected'));
      });
    }
    const values = Array.isArray(answer.answer) ? answer.answer : [answer.answer];
    return values.every((value, index) => text(editableTargets(root)[index]?.value || editableTargets(root)[index]?.textContent) === text(value));
  }

  api.fill = async (answer) => {
    const root = locateRoot(answer);
    if (!root) return { ok: false, status: 'paused', reason: '未定位到当前题目容器' };
    const type = answer.type;
    const filled = type === 'single_choice' || type === 'true_false'
      ? fillChoice(root, answer.answer)
      : type === 'multiple_choice'
        ? fillChoice(root, answer.answer, true)
        : fillText(root, answer.answer);
    if (!filled) return { ok: false, status: 'failed', reason: `没有找到可回填的${type}输入控件` };
    await new Promise((resolve) => setTimeout(resolve, 80));
    return verify(root, answer)
      ? { ok: true, status: 'completed', questionNumber: answer.questionNumber }
      : { ok: false, status: 'retry', reason: '页面未确认答案已写入' };
  };

  api.observe = (callback) => {
    const observer = new MutationObserver(callback);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    return () => observer.disconnect();
  };
})();
