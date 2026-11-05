interface AssistantLogEntry {
  time: string;
  level: string;
  message: string;
}

function requiredElement<T extends HTMLElement>(panel: HTMLElement, selector: string): T {
  const element = panel.querySelector<T>(selector);
  if (!element) throw new Error(`答案助手面板缺少元素：${selector}`);
  return element;
}

export function createAssistantLog() {
  const entries: AssistantLogEntry[] = [];

  function render(panel: HTMLElement): void {
    const consoleElement = requiredElement(panel, '[data-log-console]');
    consoleElement.replaceChildren();
    entries.forEach((entry) => {
      const line = document.createElement('div');
      line.className = `pintia-assistant-console-line is-${entry.level}`;
      line.textContent = `${entry.time} [${entry.level.toUpperCase()}] ${entry.message}`;
      consoleElement.appendChild(line);
    });
    requiredElement(panel, '[data-log-count]').textContent = String(entries.length);
    requiredElement(panel, '[data-log-tab-count]').textContent = String(entries.length);
    consoleElement.scrollTop = consoleElement.scrollHeight;
  }

  function append(panel: HTMLElement | null, message: string, level = 'info'): void {
    const entry = {
      time: new Date().toLocaleTimeString(),
      level,
      message: String(message)
    };
    entries.push(entry);
    if (entries.length > 200) entries.shift();
    const activePanel = panel?.isConnected ? panel : document.getElementById('pintia-assistant-panel');
    if (!activePanel) return;
    const consoleElement = requiredElement(activePanel, '[data-log-console]');
    const line = document.createElement('div');
    line.className = `pintia-assistant-console-line is-${level}`;
    line.textContent = `${entry.time} [${level.toUpperCase()}] ${entry.message}`;
    consoleElement.appendChild(line);
    if (consoleElement.childElementCount > 200) consoleElement.firstElementChild?.remove();
    requiredElement(activePanel, '[data-log-count]').textContent = String(entries.length);
    requiredElement(activePanel, '[data-log-tab-count]').textContent = String(entries.length);
    consoleElement.scrollTop = consoleElement.scrollHeight;
  }

  return {
    render,
    append,
    set(panel: HTMLElement, message: string, level = 'info') {
      append(panel, message, level);
    },
    clear() {
      entries.length = 0;
    }
  };
}
