/* Opciones: URL de la app y token personal de la API, guardados en chrome.storage.local. */
(function () {
  'use strict';
  var Z = window.ZsShared;
  function t(key, subs) {
    return chrome.i18n.getMessage(key, subs) || key;
  }
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll('[data-i18n]').forEach(function (node) {
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  document.title = t('optionsTitle');

  var form = document.getElementById('form');
  var baseUrl = document.getElementById('baseUrl');
  var token = document.getElementById('token');
  var track = document.getElementById('trackByDefault');
  var save = document.getElementById('save');
  var clear = document.getElementById('clear');
  var status = document.getElementById('status');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'opt-status' + (kind ? ' is-' + kind : '');
  }

  function errorText(code) {
    if (code === 'invalid_key') return t('errInvalidKey');
    if (code === 'insufficient_scope') return t('errScope');
    if (code === 'network_error') return t('errNetwork');
    if (code === 'rate_limited') return t('errRateLimited');
    return t('errGeneric');
  }

  function check() {
    setStatus(t('optionsChecking'));
    chrome.runtime.sendMessage({ type: 'me' }, function (res) {
      if (chrome.runtime.lastError || !res) return setStatus(t('errGeneric'), 'error');
      if (!res.ok) return setStatus(errorText(res.error), 'error');
      var who = res.data.email || res.data.name || '';
      var text = t('optionsConnected', [who, res.data.workspace || '']);
      setStatus(res.data.canWrite ? text : text + ' ' + t('optionsReadOnly'), 'ok');
    });
  }

  chrome.storage.local.get(['baseUrl', 'token', 'trackByDefault']).then(function (c) {
    baseUrl.value = c.baseUrl || '';
    token.value = c.token || '';
    track.checked = c.trackByDefault !== false;
    if (c.baseUrl && c.token) check();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var origin = Z.normalizeBaseUrl(baseUrl.value);
    if (!origin) {
      setStatus(t('optionsBadUrl'), 'error');
      baseUrl.focus();
      return;
    }
    var key = token.value.trim();
    if (!Z.isValidToken(key)) {
      setStatus(t('optionsBadToken'), 'error');
      token.focus();
      return;
    }
    save.disabled = true;
    // Un dominio propio (self-host) pide permiso para ese origen; zerosoft.ai y localhost ya lo tienen.
    var granted = Z.isBuiltinOrigin(origin)
      ? Promise.resolve(true)
      : chrome.permissions.request({ origins: [Z.originPattern(origin)] }).catch(function () {
          return false;
        });
    granted.then(function (ok) {
      if (!ok) {
        save.disabled = false;
        setStatus(t('optionsPermissionDenied'), 'error');
        return;
      }
      baseUrl.value = origin;
      chrome.storage.local.set({ baseUrl: origin, token: key, trackByDefault: track.checked }).then(function () {
        save.disabled = false;
        check();
      });
    });
  });

  clear.addEventListener('click', function () {
    chrome.storage.local.remove(['token']).then(function () {
      token.value = '';
      setStatus(t('optionsDisconnected'));
    });
  });
})();
