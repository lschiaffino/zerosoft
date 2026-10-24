/*
 * Service worker: única parte que habla con la API de Zerosoft (/api/v1) con
 * el token personal guardado en chrome.storage.local. El content script de
 * Gmail le pide cosas por mensajes y nunca ve el token.
 */
importScripts('shared.js');

var Z = self.ZsShared;

function getConfig() {
  return chrome.storage.local.get(['baseUrl', 'token', 'trackByDefault']).then(function (c) {
    return {
      baseUrl: Z.normalizeBaseUrl(c.baseUrl || '') || '',
      token: typeof c.token === 'string' ? c.token.trim() : '',
      trackByDefault: c.trackByDefault !== false,
    };
  });
}

/** Llamada a la API: { ok, status, data } o { ok: false, error }. */
function api(path, init) {
  return getConfig().then(function (cfg) {
    if (!cfg.baseUrl || !cfg.token) return { ok: false, status: 0, error: 'not_configured' };
    var opts = init || {};
    var headers = { authorization: 'Bearer ' + cfg.token, accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(Z.appUrl(cfg.baseUrl, path), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (res.ok) return { ok: true, status: res.status, data: data };
            var code = (data && data.error && data.error.code) || 'http_' + res.status;
            return { ok: false, status: res.status, error: code };
          });
      })
      .catch(function () {
        return { ok: false, status: 0, error: 'network_error' };
      });
  });
}

var handlers = {
  config: function () {
    return getConfig().then(function (cfg) {
      // El token no sale del service worker.
      return { ok: true, data: { baseUrl: cfg.baseUrl, configured: Boolean(cfg.baseUrl && cfg.token), trackByDefault: cfg.trackByDefault } };
    });
  },
  me: function () {
    return api('/api/v1/crm/extension/me');
  },
  sidebar: function (msg) {
    return api('/api/v1/crm/extension/sidebar?email=' + encodeURIComponent(msg.email || ''));
  },
  createContact: function (msg) {
    var body = { email: msg.email, source: 'email' };
    if (msg.firstName) body.firstName = msg.firstName;
    if (msg.lastName) body.lastName = msg.lastName;
    if (msg.jobTitle) body.jobTitle = msg.jobTitle;
    return api('/api/v1/crm/contacts', { method: 'POST', body: body });
  },
  createTask: function (msg) {
    var body = { subject: msg.subject, contactId: msg.contactId };
    if (msg.dueAt) body.dueAt = msg.dueAt;
    return api('/api/v1/crm/tasks', { method: 'POST', body: body });
  },
  completeTask: function (msg) {
    return api('/api/v1/crm/tasks/' + encodeURIComponent(msg.id), { method: 'PATCH', body: { done: true } });
  },
  logEmail: function (msg) {
    return api('/api/v1/crm/extension/log-email', { method: 'POST', body: msg.email });
  },
  templates: function () {
    return api('/api/v1/crm/extension/templates');
  },
  renderTemplate: function (msg) {
    return api('/api/v1/crm/extension/templates', { method: 'POST', body: { templateId: msg.templateId, to: msg.to || '' } });
  },
  track: function (msg) {
    return api('/api/v1/crm/extension/track', { method: 'POST', body: msg.email });
  },
  openOptions: function () {
    chrome.runtime.openOptionsPage();
    return Promise.resolve({ ok: true });
  },
  openApp: function (msg) {
    return getConfig().then(function (cfg) {
      if (!cfg.baseUrl) return { ok: false, error: 'not_configured' };
      chrome.tabs.create({ url: Z.appUrl(cfg.baseUrl, msg.path || '/app/crm') });
      return { ok: true };
    });
  },
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var h = msg && handlers[msg.type];
  if (!h) return false;
  // Solo la extensión y su content script en Gmail.
  if (sender.id !== chrome.runtime.id) return false;
  h(msg).then(sendResponse, function () {
    sendResponse({ ok: false, error: 'extension_error' });
  });
  return true;
});

chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
