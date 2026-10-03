const form = document.querySelector('#settings-form');
const message = document.querySelector('#form-message');
const submitButton = form.querySelector('[type="submit"]');
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
  form.querySelectorAll('input, select, textarea, button').forEach((control) => {
    control.disabled = false;
  });
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
    autoApplyAnswers: document.querySelector('#auto-apply-input').checked
  };
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  } catch (error) {
    showMessage(error.message || 'API 地址格式无效。');
    return;
  }

  submitButton.disabled = true;
  const origins = [`${endpoint.origin}/*`];
  chrome.permissions.request({ origins }, (granted) => {
    if (chrome.runtime.lastError) {
      submitButton.disabled = false;
      showMessage(chrome.runtime.lastError.message);
      return;
    }
    if (!granted) {
      submitButton.disabled = false;
      showMessage('未获得连接模型服务的权限。');
      return;
    }
    sendRuntimeMessage({ type: 'save-ai-config', config }, (error) => {
      submitButton.disabled = false;
      if (error) showMessage(error.message);
      else showMessage('配置已保存，可返回 Pintia 助手使用。', true);
    });
  });
});
