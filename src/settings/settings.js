const form = document.querySelector('#settings-form');
const message = document.querySelector('#form-message');
const submitButton = form.querySelector('[type="submit"]');
const secondaryCheckInput = document.querySelector('#secondary-check-input');
const separateVerifierInput = document.querySelector('#separate-verifier-input');
const verifierFields = document.querySelector('#verifier-config-fields');
form.querySelectorAll('input, select, textarea, button').forEach((control) => {
  control.disabled = true;
});

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
  message.hidden = false;
}

function sendRuntimeMessage(payload, callback) {
  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) callback(new Error(chrome.runtime.lastError.message));
    else if (response?.error) callback(new Error(response.error));
    else callback(null, response);
  });
}

function syncAdvancedSettings() {
  const separateEnabled = secondaryCheckInput.checked && separateVerifierInput.checked;
  verifierFields.hidden = !separateEnabled;
  document.querySelector('#advanced-summary-status').textContent = secondaryCheckInput.checked
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
  const config = response.config;
  document.querySelector('#api-type-input').value = config.apiType;
  document.querySelector('#endpoint-input').value = config.endpoint;
  document.querySelector('#model-input').value = config.model;
  document.querySelector('#api-key-input').value = config.apiKey || '';
  document.querySelector('#prompt-input').value = config.prompt;
  document.querySelector('#auto-apply-input').checked = config.autoApplyAnswers === true;
  secondaryCheckInput.checked = config.secondaryCheckEnabled === true;
  document.querySelector('#secondary-prompt-input').value = config.secondaryPrompt;
  separateVerifierInput.checked = config.useSeparateVerifierConfig === true;
  const verifierConfig = config.verifierConfig || {};
  document.querySelector('#verifier-api-type-input').value = verifierConfig.apiType || config.apiType;
  document.querySelector('#verifier-endpoint-input').value = verifierConfig.endpoint || config.endpoint;
  document.querySelector('#verifier-model-input').value = verifierConfig.model || config.model;
  document.querySelector('#verifier-api-key-input').value = verifierConfig.apiKey || '';
  form.querySelectorAll('input, select, textarea, button').forEach((control) => {
    control.disabled = false;
  });
  syncAdvancedSettings();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  message.hidden = true;
  const config = {
    apiType: document.querySelector('#api-type-input').value,
    endpoint: document.querySelector('#endpoint-input').value.trim(),
    model: document.querySelector('#model-input').value.trim(),
    apiKey: document.querySelector('#api-key-input').value.trim(),
    prompt: document.querySelector('#prompt-input').value.trim(),
    autoApplyAnswers: document.querySelector('#auto-apply-input').checked,
    secondaryCheckEnabled: secondaryCheckInput.checked,
    secondaryPrompt: document.querySelector('#secondary-prompt-input').value.trim(),
    useSeparateVerifierConfig: separateVerifierInput.checked,
    verifierConfig: {
      apiType: document.querySelector('#verifier-api-type-input').value,
      endpoint: document.querySelector('#verifier-endpoint-input').value.trim(),
      model: document.querySelector('#verifier-model-input').value.trim(),
      apiKey: document.querySelector('#verifier-api-key-input').value.trim()
    }
  };
  if (config.secondaryCheckEnabled && !config.secondaryPrompt) {
    showMessage('请填写答案复核提示词。');
    return;
  }
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  } catch (error) {
    showMessage(error.message || 'API 地址格式无效。');
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
      showMessage(error.message || '复核模型 API 地址格式无效。');
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
      showMessage(chrome.runtime.lastError.message);
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
