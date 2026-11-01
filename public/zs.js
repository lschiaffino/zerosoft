/*
 * zerosoft Analytics. En tu sitio:
 *   <script src="https://zerosoft.ai/zs.js" defer></script>
 *   <script>window.zs = window.zs || []; zs.push(['init', 'zsp_…']);</script>
 * o como módulo:  import zs from 'https://zerosoft.ai/zs.mjs'; zs.init('zsp_…');
 *
 * API: zs.init(key, opts), zs.capture(event, props), zs.identify(id, props),
 * zs.alias(alias), zs.group(type, key, props), zs.register(props), zs.reset(),
 * zs.isFeatureEnabled(key), zs.getFeatureFlag(key), zs.onFeatureFlags(fn),
 * zs.reloadFeatureFlags(), zs.getDistinctId(), zs.optOut(), zs.optIn(),
 * zs.captureException(err, props), zs.getSurveys(fn).
 *
 * Captura sola: $pageview (también en apps de una página), y si el proyecto
 * tiene autocapture, clicks en links y botones, cambios en campos (nunca su
 * valor) y envíos de formularios. Nada de inputs de contraseña ni elementos
 * con la clase zs-no-capture. Guarda un id anónimo en localStorage.
 *
 * Según los ajustes del proyecto (vienen en /decide; apagados por defecto):
 * errores sin atrapar ($exception) y web vitals ($web_vitals). Si hay encuestas
 * al aire, las pide y las muestra en un Shadow DOM, solo con textContent; si no
 * hay, no hace ningún pedido más.
 */
(function () {
  'use strict';
  var w = window;
  var d = document;
  if (w.zs && w.zs.__loaded) return;
  var queue = Array.isArray(w.zs) ? w.zs : [];

  var cfg = { key: null, host: '', autocapture: true, pageviews: true, debug: false };
  var state = { distinctId: null, identified: false, props: {}, groups: {}, flags: null, flagCbs: [], buffer: [], timer: null, optedOut: false, ready: false };
  var SESSION_MS = 30 * 60 * 1000;

  function now() {
    return Date.now();
  }
  function uuid() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
  }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(w.localStorage.getItem('zs_' + cfg.key + '_' + k) || 'null');
      if (v === null) w.localStorage.removeItem('zs_' + cfg.key + '_' + k);
      else w.localStorage.setItem('zs_' + cfg.key + '_' + k, JSON.stringify(v));
    } catch (e) {
      return null;
    }
    return v;
  }
  function assign(a, b) {
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k];
    return a;
  }

  function session() {
    var s = store('session');
    var t = now();
    if (!s || !s.id || t - s.last > SESSION_MS) s = { id: uuid(), last: t };
    s.last = t;
    store('session', s);
    return s.id;
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '$direct';
    }
  }

  function pageProps() {
    var loc = w.location;
    var p = {
      $current_url: loc.href,
      $host: loc.host,
      $pathname: loc.pathname,
      $referrer: d.referrer || '$direct',
      $referring_domain: d.referrer ? domainOf(d.referrer) : '$direct',
      $screen_width: w.screen ? w.screen.width : null,
      $viewport_width: w.innerWidth,
      $lib: 'zs-js',
    };
    try {
      var q = new URLSearchParams(loc.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        if (q.get(k)) p[k] = q.get(k);
      });
    } catch (e) {
      /* sin URLSearchParams */
    }
    return p;
  }

  function send(path, body, beacon) {
    var url = cfg.host + path;
    var data = JSON.stringify(body);
    // text/plain: sin preflight CORS. sendBeacon al salir de la página.
    if (beacon && w.navigator.sendBeacon) {
      try {
        if (w.navigator.sendBeacon(url, new Blob([data], { type: 'text/plain' }))) return Promise.resolve(null);
      } catch (e) {
        /* sigue con fetch */
      }
    }
    if (!w.fetch) return Promise.resolve(null);
    return w
      .fetch(url, { method: 'POST', body: data, headers: { 'content-type': 'text/plain' }, keepalive: data.length < 60000, credentials: 'omit' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function flush(beacon) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!state.buffer.length || !cfg.key) return;
    var batch = state.buffer.splice(0, 50);
    send('/api/ingest/e', { api_key: cfg.key, batch: batch, sent_at: new Date().toISOString() }, beacon);
    if (state.buffer.length) flush(beacon);
  }

  function capture(event, props) {
    if (!event || state.optedOut || !cfg.key) return;
    var p = assign(assign(pageProps(), state.props), props || {});
    p.$session_id = session();
    if (Object.keys(state.groups).length) p.$groups = assign({}, state.groups);
    var ev = { event: String(event), distinct_id: state.distinctId, properties: p, timestamp: new Date().toISOString(), uuid: uuid() };
    if (p.$set) {
      ev.$set = p.$set;
      delete p.$set;
    }
    if (p.$set_once) {
      ev.$set_once = p.$set_once;
      delete p.$set_once;
    }
    state.buffer.push(ev);
    if (cfg.debug && w.console) w.console.log('[zs]', event, p);
    if (state.buffer.length >= 20) flush(false);
    else if (!state.timer) state.timer = setTimeout(function () { flush(false); }, 1500);
  }

  function identify(id, props) {
    if (!id) return;
    id = String(id);
    var prev = state.distinctId;
    if (prev === id) {
      if (props) capture('$set', { $set: props });
      return;
    }
    // Solo un id anónimo se une al identificado: si ya había otra persona
    // identificada en este navegador, el id nuevo empieza su propia persona.
    var wasAnon = !state.identified;
    state.distinctId = id;
    state.identified = true;
    store('id', { id: id, identified: true });
    var p = { $set: props || {} };
    if (wasAnon) p.$anon_distinct_id = prev;
    capture('$identify', p);
    loadFlags();
  }

  function alias(a) {
    if (a) capture('$create_alias', { alias: String(a) });
  }

  function group(type, key, props) {
    if (!type || !key) return;
    state.groups[String(type)] = String(key);
    store('groups', state.groups);
    capture('$groupidentify', { $group_type: String(type), $group_key: String(key), $group_set: props || {} });
  }

  function register(props) {
    assign(state.props, props || {});
    store('props', state.props);
  }

  function reset() {
    state.distinctId = uuid();
    state.identified = false;
    state.props = {};
    state.groups = {};
    store('id', { id: state.distinctId, identified: false });
    store('props', null);
    store('groups', null);
    store('session', null);
    loadFlags();
  }

  // ---------- Flags ----------
  function loadFlags() {
    if (!cfg.key) return Promise.resolve(null);
    return send('/api/ingest/decide', { api_key: cfg.key, distinct_id: state.distinctId }, false).then(function (r) {
      if (!r) {
        startAutocapture();
        return null;
      }
      state.flags = r.featureFlags || {};
      if (r.config && r.config.autocapture === false) cfg.autocapture = false;
      startAutocapture();
      if (r.config) {
        cfg.respectDnt = !!r.config.respectDnt;
        if (r.config.captureExceptions) startExceptionCapture();
        if (r.config.webVitals) startWebVitals();
        if (r.config.surveys) loadSurveys();
      }
      var cbs = state.flagCbs.slice();
      cbs.forEach(function (cb) {
        try {
          cb(state.flags);
        } catch (e) {
          /* callback del sitio */
        }
      });
      return state.flags;
    });
  }
  function getFeatureFlag(k) {
    return state.flags ? state.flags[k] : undefined;
  }
  function isFeatureEnabled(k) {
    var v = getFeatureFlag(k);
    return v === undefined ? undefined : !!v;
  }
  function onFeatureFlags(cb) {
    state.flagCbs.push(cb);
    if (state.flags) cb(state.flags);
  }

  // ---------- Autocapture ----------
  var autoStarted = false;
  var MAX_TEXT = 100;
  function skip(el) {
    for (var n = el; n && n !== d.body; n = n.parentElement) {
      if (n.classList && (n.classList.contains('zs-no-capture') || n.classList.contains('ph-no-capture'))) return true;
    }
    return false;
  }
  function safeText(el) {
    var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    // Nada que parezca un email o un número largo (tarjeta, teléfono).
    if (/@/.test(t) || /\d{6,}/.test(t.replace(/[\s-]/g, ''))) return '';
    return t;
  }
  function describe(el) {
    var p = { $el_tag: el.tagName.toLowerCase() };
    if (el.id) p.$el_id = String(el.id).slice(0, 100);
    if (el.getAttribute('name')) p.$el_name = String(el.getAttribute('name')).slice(0, 100);
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 5).join(' ') : '';
    if (cls) p.$el_classes = cls;
    if (el.tagName === 'A' && el.getAttribute('href')) p.$el_href = String(el.getAttribute('href')).split('?')[0].slice(0, 300);
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) if (attrs[i].name.indexOf('data-zs-') === 0) p[attrs[i].name] = String(attrs[i].value).slice(0, 100);
    return p;
  }
  function clickable(el) {
    for (var n = el; n && n !== d.body; n = n.parentElement) {
      var tag = n.tagName;
      if (tag === 'A' || tag === 'BUTTON' || (tag === 'INPUT' && /^(submit|button|reset|checkbox|radio)$/i.test(n.type)) || n.getAttribute('role') === 'button') return n;
    }
    return null;
  }
  function startAutocapture() {
    if (autoStarted || !cfg.autocapture) return;
    autoStarted = true;
    d.addEventListener(
      'click',
      function (e) {
        var el = clickable(e.target);
        if (!el || skip(el)) return;
        var p = describe(el);
        p.$event_type = 'click';
        if (el.tagName !== 'INPUT') {
          var text = safeText(el);
          if (text) p.$el_text = text;
        }
        capture('$autocapture', p);
      },
      true,
    );
    d.addEventListener(
      'change',
      function (e) {
        var el = e.target;
        if (!el || !el.tagName || skip(el)) return;
        var tag = el.tagName;
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return;
        if (tag === 'INPUT' && /^(password|hidden)$/i.test(el.type)) return;
        // Solo qué campo cambió: nunca su valor.
        var p = describe(el);
        p.$event_type = 'change';
        if (el.type) p.$el_type = String(el.type);
        capture('$autocapture', p);
      },
      true,
    );
    d.addEventListener(
      'submit',
      function (e) {
        var el = e.target;
        if (!el || skip(el)) return;
        var p = describe(el);
        p.$event_type = 'submit';
        capture('$autocapture', p);
      },
      true,
    );
  }

  // ---------- Errores ----------
  var EXC_PER_MINUTE = 10;
  var excTimes = [];
  var excStarted = false;
  var excBusy = false;
  function cut(v, max) {
    return String(v === undefined || v === null ? '' : v).slice(0, max);
  }
  // Cuadros de un stack de Chrome, Firefox o Safari. El servidor los vuelve a validar.
  function parseFrames(stack) {
    var out = [];
    var lines = cut(stack, 20000).split('\n');
    for (var i = 0; i < lines.length && out.length < 30; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, '');
      var m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) || /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
      if (m) out.push({ file: cut(m[2], 300), function: cut(m[1], 200), line: Number(m[3]), column: Number(m[4]) });
    }
    return out;
  }
  function captureException(err, props) {
    if (excBusy) return;
    var t = now();
    excTimes = excTimes.filter(function (x) {
      return t - x < 60000;
    });
    // Un loop en la página no inunda: como mucho 10 por minuto en cada carga.
    if (excTimes.length >= EXC_PER_MINUTE) return;
    excTimes.push(t);
    excBusy = true;
    try {
      var isObj = err && typeof err === 'object';
      var p = assign({}, props || {});
      p.$exception_type = cut((isObj && (err.name || (err.constructor && err.constructor.name))) || 'Error', 200);
      p.$exception_message = cut(isObj && err.message !== undefined ? err.message : err, 1000);
      p.$exception_stack = parseFrames(isObj ? err.stack : '');
      delete p.$exception_fingerprint;
      capture('$exception', p);
    } catch (e) {
      /* capturar un error nunca rompe el sitio */
    }
    excBusy = false;
  }
  function startExceptionCapture() {
    if (excStarted) return;
    excStarted = true;
    w.addEventListener('error', function (e) {
      if (!e) return;
      if (e.error) return captureException(e.error);
      captureException(
        { name: 'Error', message: e.message || 'Script error', stack: e.filename ? 'at ' + e.filename + ':' + (e.lineno || 0) + ':' + (e.colno || 0) : '' },
      );
    });
    w.addEventListener('unhandledrejection', function (e) {
      var r = e ? e.reason : null;
      if (r && typeof r === 'object' && r.message !== undefined) return captureException(r);
      captureException({ name: 'UnhandledRejection', message: cut(r, 1000), stack: '' });
    });
  }

  // ---------- Web vitals ----------
  var vitalsStarted = false;
  function startWebVitals() {
    if (vitalsStarted || !w.PerformanceObserver) return;
    vitalsStarted = true;
    var v = {};
    var sent = false;
    var startUrl = w.location.href;
    var startPath = w.location.pathname;
    var shiftSum = 0;
    var shiftFirst = 0;
    var shiftLast = 0;
    function watch(type, fn, extra) {
      try {
        var o = new w.PerformanceObserver(function (list) {
          list.getEntries().forEach(fn);
        });
        o.observe(assign({ type: type, buffered: true }, extra || {}));
      } catch (e) {
        /* el navegador no conoce esta medida */
      }
    }
    watch('paint', function (e) {
      if (e.name === 'first-contentful-paint') v.FCP = e.startTime;
    });
    watch('largest-contentful-paint', function (e) {
      v.LCP = e.renderTime || e.loadTime || e.startTime;
    });
    // CLS: la peor ventana de cambios (máximo 5 s, con menos de 1 s entre uno y otro).
    watch('layout-shift', function (e) {
      if (e.hadRecentInput) return;
      if (shiftSum && (e.startTime - shiftLast > 1000 || e.startTime - shiftFirst > 5000)) shiftSum = 0;
      if (!shiftSum) shiftFirst = e.startTime;
      shiftSum += e.value;
      shiftLast = e.startTime;
      if (!v.CLS || shiftSum > v.CLS) v.CLS = shiftSum;
    });
    // INP: la interacción más lenta de la página.
    watch(
      'event',
      function (e) {
        if (!e.interactionId) return;
        if (!v.INP || e.duration > v.INP) v.INP = e.duration;
      },
      { durationThreshold: 40 },
    );
    function report() {
      if (sent) return;
      var p = { $pathname: startPath, $current_url: startUrl };
      var any = false;
      ['LCP', 'INP', 'CLS', 'FCP'].forEach(function (k) {
        var n = Number(v[k]);
        if (v[k] === undefined || !isFinite(n) || n < 0) return;
        p['$web_vitals_' + k + '_value'] = Math.min(k === 'CLS' ? 50 : 120000, k === 'CLS' ? Math.round(n * 10000) / 10000 : Math.round(n));
        any = true;
      });
      if (!any) return;
      sent = true;
      capture('$web_vitals', p);
      flush(true);
    }
    w.addEventListener('visibilitychange', function () {
      if (d.visibilityState === 'hidden') report();
    });
    w.addEventListener('pagehide', report);
  }

  // ---------- Encuestas ----------
  var surveyList = null;
  var surveyOpen = false;
  var surveyTimer = null;
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var SURVEY_CSS =
    ':host{all:initial}' +
    '.box{position:fixed;z-index:2147483000;bottom:16px;width:340px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:16px;' +
    'font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--t);background:var(--b);border:1px solid rgba(127,127,127,.4);border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.18)}' +
    '.box:focus{outline:none}.bottom-right{right:16px}.bottom-left{left:16px}.center{left:50%;transform:translateX(-50%)}' +
    '.q{margin:0 24px 4px 0;font-weight:600;overflow-wrap:anywhere}.d{margin:0 0 8px;opacity:.8;overflow-wrap:anywhere}' +
    '.x{position:absolute;top:8px;right:8px;width:28px;height:28px;padding:0;font:inherit;font-size:18px;line-height:1;color:inherit;background:none;border:0;border-radius:4px;cursor:pointer}' +
    '.rate{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 4px}.rate button{flex:1 0 26px;min-width:26px;height:32px;padding:0;font:inherit;color:inherit;background:none;border:1px solid rgba(127,127,127,.6);border-radius:4px;cursor:pointer}' +
    '.rate button[aria-pressed=true]{color:var(--bt);background:var(--bb);border-color:var(--bb)}' +
    '.ends{display:flex;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:12px;opacity:.8}' +
    'label{display:flex;gap:8px;align-items:flex-start;margin:6px 0;overflow-wrap:anywhere;cursor:pointer}' +
    'textarea{display:block;width:100%;box-sizing:border-box;min-height:72px;margin:8px 0;padding:8px;font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.6);border-radius:4px;resize:vertical}' +
    '.go{display:block;width:100%;margin-top:10px;padding:8px 12px;font:inherit;font-weight:600;color:var(--bt);background:var(--bb);border:0;border-radius:4px;cursor:pointer}' +
    '.go:disabled{opacity:.5;cursor:not-allowed}' +
    'button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
    '.thanks{margin:0 24px 0 0;font-weight:600;overflow-wrap:anywhere}';

  function loadSurveys() {
    return send('/api/ingest/surveys', { api_key: cfg.key, distinct_id: state.distinctId }, false).then(function (r) {
      surveyList = r && Array.isArray(r.surveys) ? r.surveys : [];
      evaluateSurveys();
      return surveyList;
    });
  }
  function surveySeen(s) {
    var rec = store('survey_' + s.id);
    if (!rec) return false;
    if (s.showOnce) return true;
    // Sin "una sola vez": puede volver en otra sesión.
    return rec.session === session();
  }
  function surveyMatches(s) {
    if (s.type !== 'popover' || !s.questions || !s.questions.length) return false;
    if (s.urlContains && w.location.href.indexOf(s.urlContains) < 0) return false;
    return !surveySeen(s);
  }
  function dntActive() {
    return cfg.respectDnt && (w.navigator.doNotTrack === '1' || w.navigator.globalPrivacyControl === true);
  }
  function evaluateSurveys() {
    if (!surveyList || surveyOpen || surveyTimer || state.optedOut || dntActive() || !d.body) return;
    for (var i = 0; i < surveyList.length; i++) {
      if (!surveyMatches(surveyList[i])) continue;
      (function (s) {
        surveyTimer = setTimeout(function () {
          surveyTimer = null;
          // Después de la demora: sigue en una página que le toca (apps de una página).
          if (surveyMatches(s) && !surveyOpen) renderSurvey(s);
          else evaluateSurveys();
        }, Math.max(0, Math.min(600, Number(s.delaySeconds) || 0)) * 1000);
      })(surveyList[i]);
      return;
    }
  }
  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    // Solo textContent: lo que escribió la persona o mandó el servidor nunca es HTML.
    if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
    return n;
  }
  function renderSurvey(s) {
    var a = s.appearance || {};
    var host = el('div', 'zs-no-capture');
    host.setAttribute('data-zs-survey', s.id);
    var root = host.attachShadow({ mode: 'open' });
    var style = el('style');
    style.textContent = SURVEY_CSS;
    root.appendChild(style);
    var pos = a.position === 'bottom-left' || a.position === 'center' ? a.position : 'bottom-right';
    var box = el('div', 'box ' + pos);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('tabindex', '-1');
    box.style.setProperty('--b', HEX.test(a.background) ? a.background : '#ffffff');
    box.style.setProperty('--t', HEX.test(a.text) ? a.text : '#111111');
    box.style.setProperty('--bb', HEX.test(a.button) ? a.button : '#111111');
    box.style.setProperty('--bt', HEX.test(a.buttonText) ? a.buttonText : '#ffffff');
    root.appendChild(box);
    var answers = {};
    var index = 0;
    var finished = false;
    var closed = false;
    function close(dismissed) {
      if (closed) return;
      closed = true;
      surveyOpen = false;
      d.removeEventListener('keydown', onKey, true);
      if (host.parentNode) host.parentNode.removeChild(host);
      if (dismissed && !finished) capture('survey dismissed', { $survey_id: s.id });
      evaluateSurveys();
    }
    function onKey(e) {
      if (e.key === 'Escape') close(true);
    }
    d.addEventListener('keydown', onKey, true);
    function closeButton() {
      var x = el('button', 'x', '\u00d7');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.onclick = function () {
        close(true);
      };
      return x;
    }
    function hasAnswer(q) {
      var v = answers[q.id];
      if (q.optional) return true;
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && String(v).replace(/\s/g, '') !== '';
    }
    function send_() {
      finished = true;
      var p = { $survey_id: s.id };
      s.questions.forEach(function (q, i) {
        var v = answers[q.id];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
        p['$survey_response_' + q.id] = v;
        if (i === 0) p.$survey_response = v;
      });
      capture('survey sent', p);
      flush(false);
      var thanks = a.thankYou ? String(a.thankYou) : '';
      if (!thanks) return close(false);
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(closeButton());
      box.appendChild(el('p', 'thanks', thanks));
      setTimeout(function () {
        close(false);
      }, 4000);
    }
    function draw() {
      var q = s.questions[index];
      while (box.firstChild) box.removeChild(box.firstChild);
      box.setAttribute('aria-label', cut(q.text, 200));
      box.appendChild(closeButton());
      var title = el('p', 'q', q.text);
      box.appendChild(title);
      if (q.description) box.appendChild(el('p', 'd', q.description));
      var go = el('button', 'go', a.submitText || 'Submit');
      go.type = 'button';
      function refresh() {
        go.disabled = !hasAnswer(q);
      }
      if (q.type === 'rating') {
        var rate = el('div', 'rate');
        rate.setAttribute('role', 'group');
        rate.setAttribute('aria-label', cut(q.text, 200));
        var scale = q.scale === 10 ? 10 : 5;
        for (var n = 1; n <= scale; n++) {
          (function (value) {
            var b = el('button', '', value);
            b.type = 'button';
            b.setAttribute('aria-pressed', answers[q.id] === value ? 'true' : 'false');
            b.onclick = function () {
              answers[q.id] = value;
              var all = rate.querySelectorAll('button');
              for (var j = 0; j < all.length; j++) all[j].setAttribute('aria-pressed', all[j] === b ? 'true' : 'false');
              refresh();
            };
            rate.appendChild(b);
          })(n);
        }
        box.appendChild(rate);
        if (q.lowLabel || q.highLabel) {
          var ends = el('div', 'ends');
          ends.appendChild(el('span', '', q.lowLabel));
          ends.appendChild(el('span', '', q.highLabel));
          box.appendChild(ends);
        }
      } else if (q.type === 'single' || q.type === 'multiple') {
        var group = el('div');
        group.setAttribute('role', q.type === 'single' ? 'radiogroup' : 'group');
        group.setAttribute('aria-label', cut(q.text, 200));
        (q.choices || []).forEach(function (choice) {
          var label = el('label');
          var input = el('input');
          input.type = q.type === 'single' ? 'radio' : 'checkbox';
          input.name = 'zs-q-' + q.id;
          input.onchange = function () {
            if (q.type === 'single') answers[q.id] = choice;
            else {
              var cur = Array.isArray(answers[q.id]) ? answers[q.id] : [];
              cur = cur.filter(function (x) {
                return x !== choice;
              });
              if (input.checked) cur.push(choice);
              answers[q.id] = cur;
            }
            refresh();
          };
          label.appendChild(input);
          label.appendChild(el('span', '', choice));
          group.appendChild(label);
        });
        box.appendChild(group);
      } else {
        var area = el('textarea');
        area.maxLength = 2000;
        area.setAttribute('aria-label', cut(q.text, 200));
        area.oninput = function () {
          answers[q.id] = area.value.slice(0, 2000);
          refresh();
        };
        box.appendChild(area);
      }
      go.onclick = function () {
        if (!hasAnswer(q)) return;
        if (index + 1 < s.questions.length) {
          index++;
          draw();
          box.focus();
        } else send_();
      };
      refresh();
      box.appendChild(go);
    }
    draw();
    surveyOpen = true;
    d.body.appendChild(host);
    // El foco solo se mueve si la persona no estaba escribiendo en otra parte.
    if (!d.activeElement || d.activeElement === d.body) box.focus();
    store('survey_' + s.id, { at: now(), session: session() });
    capture('survey shown', { $survey_id: s.id });
  }

  // ---------- Páginas ----------
  var lastPath = null;
  function pageview() {
    if (!cfg.pageviews) return;
    var path = w.location.pathname + w.location.search;
    if (path === lastPath) return;
    lastPath = path;
    capture('$pageview');
    evaluateSurveys();
  }
  function watchHistory() {
    var h = w.history;
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = h[m];
      if (typeof orig !== 'function') return;
      h[m] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(pageview, 0);
        return r;
      };
    });
    w.addEventListener('popstate', pageview);
  }

  function init(key, opts) {
    if (state.ready || !key) return;
    opts = opts || {};
    cfg.key = String(key);
    // Con init inline (sync) currentScript es ese script, sin src: se busca el de zs.js.
    var script = d.currentScript && d.currentScript.src ? d.currentScript : d.querySelector('script[src*="/zs.js"]');
    var guess = '';
    try {
      guess = script && script.src ? new URL(script.src).origin : '';
    } catch (e) {
      guess = '';
    }
    // Sin api_host ni src del script (p. ej. copiado inline): el servicio de zerosoft.
    cfg.host = String(opts.api_host || opts.host || guess || 'https://zerosoft.ai').replace(/\/$/, '');
    if (opts.autocapture === false) cfg.autocapture = false;
    if (opts.capture_pageview === false) cfg.pageviews = false;
    cfg.debug = !!opts.debug;
    state.optedOut = !!store('optout');
    var saved = store('id');
    state.distinctId = saved && saved.id ? saved.id : uuid();
    state.identified = !!(saved && saved.identified);
    if (!saved) store('id', { id: state.distinctId, identified: false });
    state.props = store('props') || {};
    state.groups = store('groups') || {};
    state.ready = true;
    // Al salir, lo que quede en el buffer va por sendBeacon.
    w.addEventListener('visibilitychange', function () {
      if (d.visibilityState === 'hidden') flush(true);
    });
    w.addEventListener('pagehide', function () {
      flush(true);
    });
    loadFlags();
    watchHistory();
    pageview();
  }

  var api = {
    __loaded: true,
    init: init,
    capture: capture,
    identify: identify,
    alias: alias,
    group: group,
    register: register,
    reset: reset,
    flush: function () {
      flush(false);
    },
    getDistinctId: function () {
      return state.distinctId;
    },
    isFeatureEnabled: isFeatureEnabled,
    getFeatureFlag: getFeatureFlag,
    onFeatureFlags: onFeatureFlags,
    reloadFeatureFlags: loadFlags,
    captureException: captureException,
    // Encuestas al aire para esta persona, también las de tipo API (se muestran y se envían desde tu código).
    getSurveys: function (cb) {
      if (!cfg.key) return;
      send('/api/ingest/surveys', { api_key: cfg.key, distinct_id: state.distinctId }, false).then(function (r) {
        if (typeof cb === 'function') cb(r && Array.isArray(r.surveys) ? r.surveys : []);
      });
    },
    optOut: function () {
      state.optedOut = true;
      state.buffer = [];
      store('optout', true);
    },
    optIn: function () {
      state.optedOut = false;
      store('optout', null);
    },
    push: function (args) {
      var m = args && api[args[0]];
      if (typeof m === 'function') m.apply(api, args.slice(1));
    },
  };
  w.zs = api;
  // Lo que se encoló antes de que cargue el script (init primero).
  queue
    .slice()
    .sort(function (a, b) {
      return (a[0] === 'init' ? 0 : 1) - (b[0] === 'init' ? 0 : 1);
    })
    .forEach(api.push);
})();
