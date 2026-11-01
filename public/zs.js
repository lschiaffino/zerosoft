/*
 * zerosoft Analytics. En tu sitio:
 *   <script src="https://zerosoft.ai/zs.js" defer></script>
 *   <script>window.zs = window.zs || []; zs.push(['init', 'zsp_…']);</script>
 * o como módulo:  import zs from 'https://zerosoft.ai/zs.mjs'; zs.init('zsp_…');
 *
 * API: zs.init(key, opts), zs.capture(event, props), zs.identify(id, props),
 * zs.alias(alias), zs.group(type, key, props), zs.register(props), zs.reset(),
 * zs.isFeatureEnabled(key), zs.getFeatureFlag(key), zs.getFeatureFlagPayload(key), zs.onFeatureFlags(fn),
 * zs.reloadFeatureFlags(), zs.getDistinctId(), zs.optOut(), zs.optIn().
 * init acepta disable_session_recording: true para no grabar nunca en esta página.
 *
 * Captura sola: $pageview (también en apps de una página), y si el proyecto
 * tiene autocapture, clicks en links y botones, cambios en campos (nunca su
 * valor) y envíos de formularios. Nada de inputs de contraseña ni elementos
 * con la clase zs-no-capture. Guarda un id anónimo en localStorage.
 *
 * Session replay y heatmaps quedan apagados salvo que un admin los prenda en el
 * proyecto; recién ahí se carga zs-replay.js. En un iframe con sandbox sin
 * allow-same-origin (como la vista de heatmaps) no se captura nada.
 */
(function () {
  'use strict';
  var w = window;
  var d = document;
  if (w.zs && w.zs.__loaded) return;
  var sandboxedFrame = w.self !== w.top && w.origin === 'null';
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
    if (replay.win) p.$window_id = replay.win;
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
    flushReplay(false);
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
      state.flagPayloads = r.featureFlagPayloads || {};
      if (r.config && r.config.autocapture === false) cfg.autocapture = false;
      if (r.config && r.config.heatmaps === true && cfg.autocapture) {
        state.heatmaps = true;
        startHeatmaps();
      }
      startAutocapture();
      if (r.config && r.config.replay) startReplay(r.config.replay);
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
  // Una vez por flag, valor y carga de página: es lo que usan los experimentos para saber quién vio qué.
  var flagCalls = {};
  function getFeatureFlag(k) {
    var v = state.flags ? state.flags[k] : undefined;
    if (v !== undefined && cfg.key) {
      var mark = k + ':' + v + ':' + state.distinctId;
      if (!flagCalls[mark]) {
        flagCalls[mark] = true;
        capture('$feature_flag_called', { $feature_flag: String(k), $feature_flag_response: v });
      }
    }
    return v;
  }
  function getFeatureFlagPayload(k) {
    return state.flagPayloads ? state.flagPayloads[k] : undefined;
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
        // Con heatmaps también cuentan los clics fuera de links y botones (sin su texto).
        var plain = !el && state.heatmaps && e.target && e.target.tagName;
        if (plain) el = e.target;
        if (!el || skip(el)) return;
        var p = describe(el);
        p.$event_type = 'click';
        if (el.tagName !== 'INPUT' && !plain) {
          var text = safeText(el);
          if (text) p.$el_text = text;
        }
        if (state.heatmaps) assign(p, clickCoords(e));
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

  // ---------- Heatmaps ----------
  // Solo si el proyecto los prendió. Posición de cada clic y, al salir de la
  // página, hasta dónde llegó el scroll (por vista: si la pestaña vuelve y baja
  // más, otro $pageleave con el mismo $pageview_id; al leer gana el mayor).
  var leave = { on: false, max: 0, sent: 0, view: '', path: '', url: '' };
  function docHeight() {
    var de = d.documentElement;
    return Math.max(de.scrollHeight, d.body ? d.body.scrollHeight : 0);
  }
  function clickCoords(e) {
    // Un clic de teclado no tiene posición.
    if (!e.detail && !e.pageX && !e.pageY) return {};
    var de = d.documentElement;
    var width = Math.max(de.scrollWidth, de.clientWidth) || 1;
    return {
      $click_x: Math.round((e.pageX / width) * 10000) / 10000,
      $click_y: Math.round(e.pageY),
      $viewport_width: w.innerWidth,
      $document_height: docHeight(),
    };
  }
  function trackScroll() {
    var h = docHeight() || 1;
    var pct = Math.min(100, Math.round(((w.pageYOffset + w.innerHeight) / h) * 100));
    if (pct > leave.max) leave.max = pct;
  }
  function resetLeave() {
    leave.max = 0;
    leave.sent = 0;
    leave.view = uuid();
    leave.path = w.location.pathname;
    leave.url = w.location.href;
    trackScroll();
  }
  function sendLeave() {
    if (!leave.on) return;
    if (leave.path === w.location.pathname) trackScroll();
    if (leave.max <= leave.sent) return;
    leave.sent = leave.max;
    capture('$pageleave', {
      $current_url: leave.url,
      $pathname: leave.path,
      $pageview_id: leave.view,
      $max_scroll_pct: leave.max,
      $viewport_width: w.innerWidth,
      $viewport_height: w.innerHeight,
      $document_height: docHeight(),
    });
  }
  function startHeatmaps() {
    if (leave.on) return;
    leave.on = true;
    resetLeave();
    w.addEventListener('scroll', trackScroll, { passive: true });
  }

  // ---------- Session replay ----------
  // Solo si el proyecto lo prendió: recién ahí se baja el grabador (zs-replay.js,
  // rrweb). Los campos siempre van enmascarados. Los chunks van en gzip si el
  // navegador puede, numerados por sesión y pestaña: un reintento no duplica.
  var REPLAY_FLUSH_MS = 8000;
  var REPLAY_CHUNK_CHARS = 256 * 1024;
  var REPLAY_MAX_CHARS = 5 * 1024 * 1024;
  var replay = { started: false, dead: false, stop: null, conf: null, sid: null, win: null, seq: 0, buf: [], chars: 0, timer: null, queue: [], sending: false, skip: false, waiting: false };

  function sessionGet(k) {
    try {
      return JSON.parse(w.sessionStorage.getItem('zs_' + cfg.key + '_' + k) || 'null');
    } catch (e) {
      return null;
    }
  }
  function sessionSet(k, v) {
    try {
      w.sessionStorage.setItem('zs_' + cfg.key + '_' + k, JSON.stringify(v));
    } catch (e) {
      /* sin sessionStorage */
    }
  }
  function sampleBucket(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 100;
  }
  function replaySession(id) {
    replay.sid = id;
    var saved = sessionGet('rseq');
    replay.seq = saved && saved.s === id ? saved.n : 0;
    replay.skip = sampleBucket(id) >= replay.conf.sampleRate;
  }
  function stopReplay() {
    replay.dead = true;
    replay.buf = [];
    replay.chars = 0;
    replay.queue = [];
    if (replay.timer) clearTimeout(replay.timer);
    if (replay.stop) {
      try {
        replay.stop();
      } catch (e) {
        /* el grabador ya paró */
      }
    }
    replay.stop = null;
  }
  function replayPump() {
    if (replay.sending || replay.dead || !replay.queue.length || !w.fetch) return;
    replay.sending = true;
    var item = replay.queue[0];
    var done = function (again) {
      replay.sending = false;
      if (again) setTimeout(replayPump, again);
      else replayPump();
    };
    var fail = function () {
      item.tries++;
      if (item.tries >= 4) {
        replay.queue.shift();
        done(0);
      } else done(item.tries * 3000);
    };
    var url = cfg.host + '/api/ingest/replay?k=' + encodeURIComponent(cfg.key);
    var payload = w.CompressionStream
      ? new Response(new Blob([item.body]).stream().pipeThrough(new w.CompressionStream('gzip'))).arrayBuffer()
      : Promise.resolve(item.body);
    payload
      .then(function (body) {
        return w.fetch(url, { method: 'POST', body: body, headers: { 'content-type': 'text/plain' }, credentials: 'omit', keepalive: (body.byteLength || body.length) < 60000 });
      })
      .then(function (res) {
        if (res.ok) {
          replay.queue.shift();
          done(0);
        } else if (res.status >= 500) fail();
        else if (res.status === 429 && !res.headers.get('retry-after')) fail();
        else if (res.status === 429) {
          return res.json().then(function (j) {
            // Límite por minuto: se reintenta. Cupo del día: se deja de grabar.
            if (j && j.error === 'rate_limited') fail();
            else stopReplay();
          });
        } else stopReplay();
        return null;
      })
      .catch(fail);
  }
  function flushReplay(leaving) {
    if (replay.timer) {
      clearTimeout(replay.timer);
      replay.timer = null;
    }
    if (!replay.buf.length || replay.dead || !cfg.key) return;
    var body =
      '{"session_id":' + JSON.stringify(replay.sid) + ',"window_id":' + JSON.stringify(replay.win) + ',"seq":' + replay.seq + ',"distinct_id":' + JSON.stringify(state.distinctId) +
      ',"sent_at":' + now() + ',"events":[' + replay.buf.join(',') + ']}';
    replay.seq++;
    sessionSet('rseq', { s: replay.sid, n: replay.seq });
    replay.buf = [];
    replay.chars = 0;
    // Al salir no hay tiempo de comprimir: un chunk chico sale plano por sendBeacon.
    if (leaving && body.length < 60000 && !replay.queue.length && w.navigator.sendBeacon) {
      try {
        if (w.navigator.sendBeacon(cfg.host + '/api/ingest/replay?k=' + encodeURIComponent(cfg.key), new Blob([body], { type: 'text/plain' }))) return;
      } catch (e) {
        /* sigue por la cola */
      }
    }
    if (replay.queue.length >= 20) {
      stopReplay();
      return;
    }
    replay.queue.push({ body: body, tries: 0 });
    replayPump();
  }
  var REPLAY_ACTIVE = { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 7: 1, 12: 1 };
  function onReplayEvent(ev) {
    if (replay.dead) return;
    var active = ev.type === 3 && ev.data && REPLAY_ACTIVE[ev.data.source];
    var s = store('session');
    var expired = !s || s.id !== replay.sid || now() - s.last > SESSION_MS;
    if (active && expired) {
      // La persona volvió después de la sesión anterior: grabación nueva, con su foto inicial.
      flushReplay(false);
      replaySession(session());
      replay.waiting = true;
      setTimeout(function () {
        if (!replay.dead && !replay.skip && w.rrwebRecord && w.rrwebRecord.record) w.rrwebRecord.record.takeFullSnapshot(true);
      }, 0);
      return;
    }
    if (active) session();
    // Una pestaña quieta no sigue mandando mutaciones para siempre.
    if (expired && ev.type !== 2 && ev.type !== 4) return;
    if (replay.skip) return;
    if (replay.waiting) {
      if (ev.type !== 4 && ev.type !== 2) return;
      replay.waiting = false;
    }
    var str;
    try {
      str = JSON.stringify(ev);
    } catch (e) {
      return;
    }
    if (str.length > REPLAY_MAX_CHARS) {
      stopReplay();
      return;
    }
    if (replay.chars + str.length > REPLAY_MAX_CHARS) flushReplay(false);
    replay.buf.push(str);
    replay.chars += str.length;
    if (replay.chars >= REPLAY_CHUNK_CHARS) flushReplay(false);
    else if (!replay.timer) replay.timer = setTimeout(function () { flushReplay(false); }, REPLAY_FLUSH_MS);
  }
  function beginRecording() {
    if (replay.dead || !w.rrwebRecord || !w.rrwebRecord.record || state.optedOut) return;
    try {
      replay.stop = w.rrwebRecord.record({
        emit: onReplayEvent,
        maskAllInputs: true,
        maskTextSelector: replay.conf.maskAllText ? '*' : null,
        blockClass: /(^|\s)(zs-no-capture|ph-no-capture)(\s|$)/,
        ignoreClass: 'zs-no-capture',
        slimDOMOptions: 'all',
        inlineStylesheet: true,
        collectFonts: false,
        recordCanvas: false,
        recordCrossOriginIframes: false,
        sampling: { mousemove: 100, scroll: 150, input: 'last' },
      });
    } catch (e) {
      stopReplay();
    }
  }
  function startReplay(conf) {
    if (replay.started || !conf || !conf.enabled || cfg.noReplay || state.optedOut) return;
    replay.started = true;
    replay.conf = { sampleRate: Number(conf.sampleRate) || 100, maskAllText: conf.maskAllText !== false };
    var win = sessionGet('window');
    if (!win) {
      win = uuid();
      sessionSet('window', win);
    }
    replay.win = win;
    replaySession(session());
    // Sesión fuera de la muestra: en esta carga de página no se baja el grabador.
    if (replay.skip) return;
    if (w.rrwebRecord) beginRecording();
    else loadRecorder();
  }
  function loadRecorder() {
    var s = d.createElement('script');
    s.src = cfg.host + '/zs-replay.js';
    s.async = true;
    s.onload = beginRecording;
    (d.head || d.documentElement).appendChild(s);
  }

  // ---------- Páginas ----------
  var lastPath = null;
  function pageview() {
    if (leave.on && leave.path !== w.location.pathname) {
      sendLeave();
      resetLeave();
    }
    if (!cfg.pageviews) return;
    var path = w.location.pathname + w.location.search;
    if (path === lastPath) return;
    lastPath = path;
    capture('$pageview');
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
    if (state.ready || !key || sandboxedFrame) return;
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
    cfg.noReplay = opts.disable_session_recording === true;
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
      if (d.visibilityState === 'hidden') {
        sendLeave();
        flush(true);
        flushReplay(true);
      }
    });
    w.addEventListener('pagehide', function () {
      sendLeave();
      flush(true);
      flushReplay(true);
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
    getFeatureFlagPayload: getFeatureFlagPayload,
    onFeatureFlags: onFeatureFlags,
    reloadFeatureFlags: loadFlags,
    optOut: function () {
      state.optedOut = true;
      state.buffer = [];
      if (replay.started) stopReplay();
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
