/*
 * zerosoft Analytics. En tu sitio:
 *   <script src="https://zerosoft.ai/zs.js" defer></script>
 *   <script>window.zs = window.zs || []; zs.push(['init', 'zsp_…']);</script>
 * o como módulo:  import zs from 'https://zerosoft.ai/zs.mjs'; zs.init('zsp_…');
 *
 * API: zs.init(key, opts), zs.capture(event, props), zs.identify(id, props),
 * zs.alias(alias), zs.group(type, key, props), zs.register(props), zs.reset(),
 * zs.isFeatureEnabled(key), zs.getFeatureFlag(key), zs.onFeatureFlags(fn),
 * zs.reloadFeatureFlags(), zs.getDistinctId(), zs.optOut(), zs.optIn().
 *
 * Captura sola: $pageview (también en apps de una página), y si el proyecto
 * tiene autocapture, clicks en links y botones, cambios en campos (nunca su
 * valor) y envíos de formularios. Nada de inputs de contraseña ni elementos
 * con la clase zs-no-capture. Guarda un id anónimo en localStorage.
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

  // ---------- Páginas ----------
  var lastPath = null;
  function pageview() {
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
