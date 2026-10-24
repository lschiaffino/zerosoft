/*
 * Zerosoft CRM para Gmail: funciones puras que usan el content script, el
 * service worker y la página de opciones (y los tests unitarios con require).
 */
(function (root) {
  'use strict';

  /** Orígenes cubiertos por host_permissions del manifest (no piden permiso extra). */
  var BUILTIN_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*zerosoft\.ai$/i, /^http:\/\/localhost(:\d+)?$/i, /^http:\/\/127\.0\.0\.1(:\d+)?$/i];

  /** URL de la app → origen sin barra final (o null si no es http/https). */
  function normalizeBaseUrl(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    if (!s) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return u.origin;
    } catch (e) {
      return null;
    }
  }

  function isBuiltinOrigin(origin) {
    return BUILTIN_ORIGINS.some(function (re) {
      return re.test(origin);
    });
  }

  /** Patrón para chrome.permissions con el origen de la app. */
  function originPattern(origin) {
    return origin.replace(/:\d+$/, '') + '/*';
  }

  /** Token personal de la API: zs_ seguido del secreto. */
  function isValidToken(token) {
    return typeof token === 'string' && /^zs_[A-Za-z0-9_-]{16,}$/.test(token.trim());
  }

  /** Emails (minúsculas, sin repetir) de un texto como "Ana <ana@x.com>, bob@y.com". */
  function parseEmails(text) {
    var out = [];
    var re = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    var m;
    while ((m = re.exec(String(text || '')))) {
      var e = m[0].toLowerCase();
      if (out.indexOf(e) < 0) out.push(e);
    }
    return out;
  }

  /** "Ana María Pérez" → { firstName: 'Ana María', lastName: 'Pérez' }. */
  function splitName(name) {
    var parts = String(name || '')
      .replace(/["<>]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }

  /** <img> del pixel de aperturas, invisible y sin estilos que Gmail quite. */
  function pixelHtml(url) {
    var safe = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return '<img src="' + safe + '" width="1" height="1" alt="" border="0" data-zs-pixel="1">';
  }

  /** Texto de un template → HTML para el cuerpo de Gmail (una línea por div, escapado). */
  function textToHtml(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (line) {
        var safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<div>' + (safe || '<br>') + '</div>';
      })
      .join('');
  }

  /** Monto con moneda en el idioma del navegador (sin decimales si es entero). */
  function formatAmount(amount, currency, locale) {
    var n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(locale || 'en', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
    } catch (e) {
      return (currency || '') + ' ' + n;
    }
  }

  /** Fecha de vencimiento corta ("Oct 24") y si está vencida. */
  function formatDue(iso, locale, now) {
    if (!iso) return { label: '', overdue: false };
    var d = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || String(iso).length <= 10 ? '' : 'Z'));
    if (isNaN(d.getTime())) return { label: '', overdue: false };
    var ref = now || new Date();
    var label;
    try {
      label = new Intl.DateTimeFormat(locale || 'en', { month: 'short', day: 'numeric' }).format(d);
    } catch (e) {
      label = d.toISOString().slice(0, 10);
    }
    return { label: label, overdue: d.getTime() < ref.getTime() };
  }

  /** URL absoluta de una ruta de la app ("/app/crm/contacts/x"). */
  function appUrl(origin, path) {
    return String(origin || '').replace(/\/$/, '') + (String(path).charAt(0) === '/' ? path : '/' + path);
  }

  var api = {
    normalizeBaseUrl: normalizeBaseUrl,
    isBuiltinOrigin: isBuiltinOrigin,
    originPattern: originPattern,
    isValidToken: isValidToken,
    parseEmails: parseEmails,
    splitName: splitName,
    pixelHtml: pixelHtml,
    textToHtml: textToHtml,
    formatAmount: formatAmount,
    formatDue: formatDue,
    appUrl: appUrl,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZsShared = api;
})(typeof self !== 'undefined' ? self : this);
