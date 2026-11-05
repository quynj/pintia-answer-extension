import type { AiConfig, VerifierConfig } from '../shared/types';

type SettingsFormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`设置页面缺少或类型错误的元素：${id}`);
  return element;
}

function formControl(id: string): SettingsFormControl {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)
    && !(element instanceof HTMLSelectElement)
    && !(element instanceof HTMLTextAreaElement)
    && !(element instanceof HTMLButtonElement)) {
    throw new Error(`设置页面缺少或类型错误的表单控件：${id}`);
  }
  return element;
}

const form = requiredElement('settings-form', HTMLFormElement);
const message = requiredElement('form-message', HTMLElement);
const submitButton = form.querySelector<HTMLButtonElement>('[type="submit"]');
if (!submitButton) throw new Error('设置页面缺少保存按钮。');
const secondaryCheckInput = requiredElement('secondary-check-input', HTMLInputElement);
const separateVerifierInput = requiredElement('separate-verifier-input', HTMLInputElement);
const secondaryPromptOption = requiredElement('secondary-prompt-option', HTMLLabelElement);
const separateVerifierOption = requiredElement('separate-verifier-option', HTMLLabelElement);
const verifierFields = requiredElement('verifier-config-fields', HTMLElement);
form.querySelectorAll<SettingsFormControl>('input, select, textarea, button').forEach((control) => {
  control.disabled = true;
});

function showMessage(text: string, success = false): void {
  message.textContent = text;
  message.classList.toggle('success', success);
  message.hidden = false;
}

function sendRuntimeMessage(
  payload: Record<string, unknown>,
  callback: (error: Error | null, response?: Record<string, unknown>) => void
): void {
  chrome.runtime.sendMessage(payload, (response: unknown) => {
    if (chrome.runtime.lastError) callback(new Error(chrome.runtime.lastError.message));
    else if (isRecord(response) && response.error) callback(new Error(String(response.error)));
    else callback(null, isRecord(response) ? response : undefined);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAiConfig(value: unknown): value is AiConfig {
  if (!isRecord(value)) return false;
  return (value.apiType === 'chat-completions' || value.apiType === 'responses')
    && typeof value.endpoint === 'string'
    && typeof value.model === 'string'
    && typeof value.apiKey === 'string'
    && typeof value.prompt === 'string'
    && typeof value.autoApplyAnswers === 'boolean'
    && typeof value.requestTimeoutSeconds === 'number'
    && typeof value.secondaryCheckEnabled === 'boolean'
    && typeof value.secondaryPrompt === 'string'
    && typeof value.useSeparateVerifierConfig === 'boolean'
    && (value.verifierConfig === undefined || isVerifierConfig(value.verifierConfig));
}

function isVerifierConfig(value: unknown): value is VerifierConfig {
  return isRecord(value)
    && (value.apiType === 'chat-completions' || value.apiType === 'responses')
    && typeof value.endpoint === 'string'
    && typeof value.model === 'string'
    && typeof value.apiKey === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。';
}

function syncAdvancedSettings(): void {
  const reviewEnabled = secondaryCheckInput.checked;
  secondaryPromptOption.hidden = !reviewEnabled;
  separateVerifierOption.hidden = !reviewEnabled;
  verifierFields.hidden = !reviewEnabled || !separateVerifierInput.checked;
  requiredElement('advanced-summary-status', HTMLElement).textContent = secondaryCheckInput.checked
    ? `答案复核：已启用${separateVerifierInput.checked ? ' · 独立模型' : ' · 使用主模型'}`
    : '答案复核已关闭';
}

secondaryCheckInput.addEventListener('change', syncAdvancedSettings);
separateVerifierInput.addEventListener('change', syncAdvancedSettings);

sendRuntimeMessage({ type: 'get-ai-config' }, (error, response) => {
  if (error) {
    showMessage(error.message);
    return;
  }
  if (!response || !isAiConfig(response.config)) {
    showMessage('后台返回的 AI 配置格式无效。');
    return;
  }
  const config = response.config;
  formControl('api-type-input').value = config.apiType;
  formControl('endpoint-input').value = config.endpoint;
  formControl('model-input').value = config.model;
  formControl('api-key-input').value = config.apiKey || '';
  formControl('prompt-input').value = config.prompt;
  formControl('request-timeout-input').value = String(config.requestTimeoutSeconds);
  secondaryCheckInput.checked = config.secondaryCheckEnabled === true;
  formControl('secondary-prompt-input').value = config.secondaryPrompt;
  separateVerifierInput.checked = config.useSeparateVerifierConfig === true;
  const verifierConfig = config.verifierConfig;
  formControl('verifier-api-type-input').value = verifierConfig?.apiType || config.apiType;
  formControl('verifier-endpoint-input').value = verifierConfig?.endpoint || config.endpoint;
  formControl('verifier-model-input').value = verifierConfig?.model || config.model;
  formControl('verifier-api-key-input').value = verifierConfig?.apiKey || '';
  form.querySelectorAll<SettingsFormControl>('input, select, textarea, button').forEach((control) => {
    control.disabled = false;
  });
  syncAdvancedSettings();
});

form.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  message.hidden = true;
  const config = {
    apiType: formControl('api-type-input').value,
    endpoint: formControl('endpoint-input').value.trim(),
    model: formControl('model-input').value.trim(),
    apiKey: formControl('api-key-input').value.trim(),
    prompt: formControl('prompt-input').value.trim(),
    requestTimeoutSeconds: Number(formControl('request-timeout-input').value),
    secondaryCheckEnabled: secondaryCheckInput.checked,
    secondaryPrompt: formControl('secondary-prompt-input').value.trim(),
    useSeparateVerifierConfig: separateVerifierInput.checked,
    verifierConfig: {
      apiType: formControl('verifier-api-type-input').value,
      endpoint: formControl('verifier-endpoint-input').value.trim(),
      model: formControl('verifier-model-input').value.trim(),
      apiKey: formControl('verifier-api-key-input').value.trim()
    }
  };
  if (config.secondaryCheckEnabled && !config.secondaryPrompt) {
    showMessage('请填写答案复核提示词。');
    return;
  }
  if (!Number.isInteger(config.requestTimeoutSeconds) || config.requestTimeoutSeconds < 10 || config.requestTimeoutSeconds > 300) {
    showMessage('单次模型请求超时必须为 10 到 300 秒之间的整数。');
    return;
  }
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  } catch (error) {
    showMessage(errorMessage(error) || 'API 地址格式无效。');
    return;
  }

  let verifierEndpoint;
  if (config.secondaryCheckEnabled && config.useSeparateVerifierConfig) {
    try {
      verifierEndpoint = new URL(config.verifierConfig.endpoint);
      if (!['http:', 'https:'].includes(verifierEndpoint.protocol)) {
        throw new Error('复核模型 API 地址必须使用 HTTP 或 HTTPS。');
      }
    } catch (error) {
      showMessage(errorMessage(error) || '复核模型 API 地址格式无效。');
      return;
    }
    if (!config.verifierConfig.model) {
      showMessage('请填写复核模型名称。');
      return;
    }
    if (!config.verifierConfig.apiKey) {
      showMessage('请填写复核模型 API Key。');
      return;
    }
  }

  submitButton.disabled = true;
  const origins = [...new Set([
    `${endpoint.origin}/*`,
    ...(verifierEndpoint ? [`${verifierEndpoint.origin}/*`] : [])
  ])];
  chrome.permissions.request({ origins }, (granted) => {
    if (chrome.runtime.lastError) {
      submitButton.disabled = false;
      showMessage(chrome.runtime.lastError.message || '站点权限申请失败。');
      return;
    }
    if (!granted) {
      submitButton.disabled = false;
      showMessage('未获得访问模型服务所需的站点权限。');
      return;
    }
    sendRuntimeMessage({ type: 'save-ai-config', config }, (error) => {
      submitButton.disabled = false;
      if (error) showMessage(error.message);
      else showMessage('配置已保存。请返回 Pintia 页面继续操作。', true);
    });
  });
});
export {};
