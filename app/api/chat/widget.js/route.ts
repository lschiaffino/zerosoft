import { NextResponse } from 'next/server';
import { getChatWidget } from '@/lib/chat-data';
import { CHAT_MESSAGE_MAX } from '@/lib/chat-schema';
import { pickWidgetLocale, WIDGET_STRINGS } from '@/lib/chat-widget-i18n';

export const dynamic = 'force-dynamic';

function buildScript(widget: Awaited<ReturnType<typeof getChatWidget>>, origin: string) {
  const id = widget!.id;
  const color = widget!.color;
  const position = widget!.position;
  // Sin mensaje propio: el saludo por defecto en el idioma del visitante.
  const welcomeMessage = widget!.welcome_message || null;
  const localeSetting = widget!.locale ?? 'auto';
  const fields = (() => {
    try {
      const parsed = JSON.parse(widget!.fields);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return `(function () {
  var WIDGET_ID = ${JSON.stringify(id)};
  var COLOR = ${JSON.stringify(color)};
  var POSITION = ${JSON.stringify(position)};
  // Idioma: data-locale / zsChatSettings.locale, idioma fijo del widget,
  // <html lang> de la página o el navegador. Textos de chat.visitorWidget.
  var STRINGS = ${JSON.stringify(WIDGET_STRINGS)};
  var pickLocale = ${pickWidgetLocale.toString()};
  var LOCALE = (function () {
    var el = document.currentScript;
    var override = el && el.getAttribute ? el.getAttribute('data-locale') : null;
    try {
      if (!override && window.zsChatSettings && window.zsChatSettings.locale) override = window.zsChatSettings.locale;
    } catch (e) {}
    var htmlLang = document.documentElement ? document.documentElement.getAttribute('lang') : null;
    var nav = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]);
    return pickLocale(override, ${JSON.stringify(localeSetting)}, htmlLang, nav);
  })();
  function T(key, vars) {
    var s = (STRINGS[LOCALE] && STRINGS[LOCALE][key]) || STRINGS.en[key] || key;
    for (var k in vars || {}) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  var WELCOME = ${JSON.stringify(welcomeMessage)} || T('defaultWelcome');
  var FIELDS = ${JSON.stringify(fields)};
  var ORIGIN = ${JSON.stringify(origin)};
  // Pestaña "Help": artículos publicados del centro de ayuda (Docs).
  var HELP = ${JSON.stringify(widget!.help_enabled === 1)};
  var STORAGE_KEY = 'zs_chat_visitor_' + WIDGET_ID;
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var MAX_MESSAGE = ${CHAT_MESSAGE_MAX};

  // Respaldo si el servidor no emitió la clave: aleatoria con crypto (nunca Math.random).
  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    } catch (e) {
      return null;
    }
  }

  function storedVisitorId() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeVisitorId(id) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {}
  }

  function api(path, opts) {
    opts = opts || {};
    // Con FormData el navegador pone multipart/form-data con su boundary: no pisarlo.
    var isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    return fetch(ORIGIN + path, Object.assign(isForm ? {} : { headers: { 'content-type': 'application/json' } }, opts));
  }

  // attachments puede llegar como array o (respuestas viejas) como texto JSON.
  function messageAttachments(m) {
    var a = m && m.attachments;
    if (typeof a === 'string') {
      try { a = JSON.parse(a); } catch (e) { a = []; }
    }
    return Array.isArray(a) ? a : [];
  }

  // Solo URLs http(s) o rutas del propio server (las de /uploads): nada de
  // javascript:, data:, etc. en el href/src de un adjunto.
  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    if (/^https?:/i.test(u)) return u;
    // '/x' sí; '//host' o '/\\host' no (son URLs a otro origen). 92 = barra invertida.
    if (u.charAt(0) === '/' && u.charAt(1) !== '/' && u.charCodeAt(1) !== 92) return ORIGIN + u;
    return null;
  }

  function dom(tag, attrs, children) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) {
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(n) / Math.log(1024));
    return (n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  // Identidad opcional del visitante (p. ej. la persona logueada en el sitio
  // que embebe el widget). Se declara antes de cargar con
  // window.zsChatSettings = { email, name, userHash } o data-email /
  // data-name / data-user-hash en el <script>, o después con
  // window.zsChat.identify({ email, name, userHash }). Sin userHash es
  // información declarada (no verificada). userHash es el HMAC-SHA256 del
  // email en minúsculas con el secreto del widget, calculado en el server del
  // sitio: con una firma válida el email queda verificado en el inbox.
  var SCRIPT_EL = document.currentScript;
  var identity = { email: null, name: null, userHash: null };
  function cleanIdentity(o) {
    if (!o || typeof o !== 'object') return;
    if (typeof o.email === 'string') {
      var e = o.email.trim().slice(0, 254);
      if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) {
        // La firma es de un email: si cambia el email, la anterior ya no vale.
        if (e !== identity.email) identity.userHash = null;
        identity.email = e;
      }
    }
    if (typeof o.userHash === 'string' && /^[0-9a-fA-F]{64}$/.test(o.userHash)) identity.userHash = o.userHash;
    if (typeof o.name === 'string') {
      var n = o.name.replace(/[\\u0000-\\u001f]/g, '').trim().slice(0, 120);
      if (n) identity.name = n;
    }
  }
  if (SCRIPT_EL && SCRIPT_EL.getAttribute) {
    cleanIdentity({
      email: SCRIPT_EL.getAttribute('data-email'),
      name: SCRIPT_EL.getAttribute('data-name'),
      userHash: SCRIPT_EL.getAttribute('data-user-hash'),
    });
  }
  try { cleanIdentity(window.zsChatSettings); } catch (e) {}
  var zsChat = (window.zsChat = window.zsChat || {});
  zsChat._widgets = zsChat._widgets || {};
  zsChat._widgets[WIDGET_ID] = { identify: cleanIdentity };
  zsChat.identify = function (o) {
    for (var k in zsChat._widgets) {
      if (Object.prototype.hasOwnProperty.call(zsChat._widgets, k)) zsChat._widgets[k].identify(o);
    }
  };
  function withIdentity(payload) {
    if (identity.email) payload.email = identity.email;
    if (identity.name) payload.name = identity.name;
    if (identity.email && identity.userHash) payload.userHash = identity.userHash;
    payload.context = pageContext();
    return payload;
  }

  // Página desde la que escribe el visitante (la ve el equipo en el inbox y
  // sirve de link de vuelta en el email de respuestas sin leer). Sin el hash.
  function pageContext() {
    var ctx = {};
    try {
      ctx.url = String(location.href).split('#')[0].slice(0, 1000);
      ctx.title = String(document.title || '').slice(0, 200);
      if (document.referrer) ctx.referrer = String(document.referrer).slice(0, 1000);
      if (navigator.language) ctx.language = String(navigator.language).slice(0, 35);
    } catch (e) {}
    return ctx;
  }

  // La clave del visitante la emite el servidor (firmada); mientras llega, nada usa visitorId.
  var visitorId = storedVisitorId();
  var visitorReady = visitorId
    ? Promise.resolve(visitorId)
    : fetch(ORIGIN + '/api/chat/visitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgetId: WIDGET_ID }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (d) {
          visitorId = (d && d.visitorId) || uuid();
          if (visitorId) storeVisitorId(visitorId);
          return visitorId;
        });
  var open = false;
  var conversationId = null;
  var lastMessageId = null;
  var pollTimer = null;
  var typingTimer = null;
  var lastTypingAt = 0;
  var selectedFile = null;
  var uploading = false;
  var messageReadMap = {};
  var visitorBubbles = {};
  var renderedEdits = {};
  var formRequest = null;
  // Mensaje saliente al que responde el visitante (la conversación arranca con él).
  var pendingOutbound = null;
  var OB_SEEN_KEY = 'zs_chat_ob_' + WIDGET_ID;
  var FIRST_KEY = 'zs_chat_first_' + WIDGET_ID;
  // Visitante nuevo (primera vez en el sitio) o que vuelve (más de 30 min después).
  var firstSeenAt = (function () {
    try {
      var v = Number(localStorage.getItem(FIRST_KEY) || 0);
      if (!v) localStorage.setItem(FIRST_KEY, String(Date.now()));
      return v;
    } catch (e) {
      return 0;
    }
  })();

  var root = dom('div', {
    id: 'zs-chat-root',
    style:
      'position:fixed;z-index:99999;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.4;',
  });

  var btn = dom('button', {
    id: 'zs-chat-btn',
    'aria-label': T('openChat'),
    style:
      'position:fixed;bottom:20px;' +
      (POSITION === 'bottom-left' ? 'left:20px;' : 'right:20px;') +
      'width:56px;height:56px;border-radius:50%;border:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;background:' +
      COLOR +
      ';color:#fff;display:flex;align-items:center;justify-content:center;transition:transform 0.15s;',
  });
  btn.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  var box = dom('div', {
    id: 'zs-chat-box',
    style:
      'position:fixed;bottom:88px;width:360px;max-width:calc(100vw - 40px);height:480px;max-height:calc(100vh - 120px);' +
      (POSITION === 'bottom-left' ? 'left:20px;' : 'right:20px;') +
      'background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,0.08);',
  });

  var header = dom('div', {
    style:
      'padding:14px 16px;background:' +
      COLOR +
      ';color:#fff;font-weight:600;display:flex;align-items:center;justify-content:space-between;',
  });
  var tabChat = null;
  var tabHelp = null;
  if (HELP) {
    var tabs = dom('div', { style: 'display:flex;gap:4px;', role: 'tablist' });
    var tabStyle = 'background:none;border:none;color:#fff;font:inherit;font-weight:600;cursor:pointer;padding:2px 8px;border-radius:4px;';
    tabChat = dom('button', { type: 'button', role: 'tab', 'aria-selected': 'true', style: tabStyle + 'background:rgba(255,255,255,0.18);' }, [T('chat')]);
    tabHelp = dom('button', { type: 'button', role: 'tab', 'aria-selected': 'false', style: tabStyle + 'opacity:0.75;' }, [T('help')]);
    tabs.appendChild(tabChat);
    tabs.appendChild(tabHelp);
    header.appendChild(tabs);
  } else {
    header.appendChild(dom('span', {}, [T('chat')]));
  }
  var headActions = dom('div', { style: 'display:flex;align-items:center;gap:6px;' });
  var historyBtn = dom('button', {
    type: 'button',
    style: 'background:none;border:none;color:#fff;font:inherit;font-size:12px;font-weight:500;cursor:pointer;padding:2px 6px;border-radius:4px;',
    'aria-label': T('history'),
    'aria-expanded': 'false',
  }, [T('history')]);
  var closeBtn = dom('button', { style: 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;', 'aria-label': T('close') }, ['×']);
  headActions.appendChild(historyBtn);
  headActions.appendChild(closeBtn);
  header.appendChild(headActions);

  var messages = dom('div', { style: 'flex:1;overflow-y:auto;padding:16px;background:#f8f8f8;' });

  var awayBanner = dom('div', {
    style:
      'display:none;padding:10px 16px;background:#f5f5f5;color:#444;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.06);',
  });

  var csatWrap = dom('div', {
    style: 'display:none;padding:14px 16px;background:#fff;border-top:1px solid rgba(0,0,0,0.06);',
  });
  var csatQuestion = dom('p', { style: 'margin:0 0 8px;font-size:13px;font-weight:600;color:#111;' }, [T('csatQuestion')]);
  var csatStars = dom('div', { style: 'display:flex;gap:4px;margin-bottom:8px;' });
  var csatComment = dom('textarea', {
    placeholder: T('csatComment'),
    rows: '2',
    style:
      'width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:6px 8px;font-size:12px;margin-bottom:8px;resize:none;font-family:inherit;',
  });
  var csatSend = dom('button', {
    type: 'button',
    style:
      'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;opacity:0.4;',
  }, [T('csatSend')]);
  csatWrap.appendChild(csatQuestion);
  csatWrap.appendChild(csatStars);
  csatWrap.appendChild(csatComment);
  csatWrap.appendChild(csatSend);

  var typingIndicator = dom('div', {
    style:
      'display:none;align-items:center;gap:6px;padding:8px 16px;font-size:12px;color:#666;background:#fff;border-top:1px solid rgba(0,0,0,0.04);',
  });
  typingIndicator.innerHTML =
    '<span class="zs-chat-typing-dots"><span></span><span></span><span></span></span> Agent is typing…';

  var previewWrap = dom('div', {
    style:
      'display:none;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(0,0,0,0.06);background:#fff;',
  });
  var previewBody = dom('div', { style: 'flex:1;min-width:0;font-size:12px;color:#444;' }, []);
  var previewRemove = dom('button', {
    type: 'button',
    style:
      'background:none;border:none;color:#888;cursor:pointer;font-size:16px;line-height:1;padding:4px;',
    'aria-label': T('removeFile'),
  }, ['×']);
  previewWrap.appendChild(previewBody);
  previewWrap.appendChild(previewRemove);

  var inputWrap = dom('div', { style: 'padding:12px;border-top:1px solid rgba(0,0,0,0.06);background:#fff;display:flex;gap:8px;align-items:center;' });
  var attachBtn = dom('button', {
    type: 'button',
    style:
      'background:none;border:none;color:#666;cursor:pointer;font-size:18px;line-height:1;padding:4px;',
    'aria-label': T('attachFile'),
    title: T('attachFile'),
  }, ['⊕']);
  var fileInput = dom('input', { type: 'file', style: 'display:none;' });
  var input = dom('input', {
    type: 'text',
    placeholder: T('placeholder'),
    'aria-label': T('message'),
    maxlength: String(MAX_MESSAGE),
    style: 'flex:1;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px 10px;outline:none;',
  });
  var send = dom('button', {
    type: 'button',
    style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:500;',
    'aria-label': T('send'),
  }, [T('send')]);
  inputWrap.appendChild(attachBtn);
  inputWrap.appendChild(fileInput);
  inputWrap.appendChild(input);
  inputWrap.appendChild(send);
  // Error al enviar (429, demasiado largo, sin red): el texto vuelve al input.
  var sendError = dom('div', { role: 'alert', style: 'display:none;padding:0 12px 8px;background:#fff;color:#b00020;font-size:12px;' });

  var formWrap = dom('div', { style: 'padding:16px;border-bottom:1px solid rgba(0,0,0,0.06);background:#fff;display:none;' });

  // Sugerencias de artículos mientras el visitante escribe (antes de empezar la conversación).
  var suggestWrap = dom('div', {
    style: 'display:none;padding:10px 12px;border-top:1px solid rgba(0,0,0,0.06);background:#fff;font-size:12px;',
  });

  var chatPane = dom('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0;' });
  var helpPane = dom('div', { style: 'flex:1;display:none;flex-direction:column;min-height:0;background:#fff;' });
  var helpSearch = dom('input', {
    type: 'search',
    placeholder: T('searchArticles'),
    'aria-label': T('searchArticlesLabel'),
    style: 'margin:12px 12px 4px;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px 10px;outline:none;font:inherit;',
  });
  var helpList = dom('div', { style: 'flex:1;overflow-y:auto;padding:4px 12px 8px;' });
  var helpFoot = dom('div', { style: 'padding:10px 12px;border-top:1px solid rgba(0,0,0,0.06);font-size:12px;display:none;' });
  helpPane.appendChild(helpSearch);
  helpPane.appendChild(helpList);
  helpPane.appendChild(helpFoot);

  box.appendChild(header);
  chatPane.appendChild(formWrap);
  chatPane.appendChild(awayBanner);
  chatPane.appendChild(messages);
  chatPane.appendChild(csatWrap);
  chatPane.appendChild(typingIndicator);
  chatPane.appendChild(previewWrap);
  chatPane.appendChild(suggestWrap);
  chatPane.appendChild(inputWrap);
  chatPane.appendChild(sendError);
  // Conversaciones anteriores del visitante (y las de su email verificado en otros dispositivos).
  var historyPane = dom('div', { style: 'flex:1;display:none;flex-direction:column;min-height:0;background:#fff;' });
  var historyHead = dom('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,0.06);font-size:13px;font-weight:600;color:#111;' });
  var historyTitle = dom('span', {}, [T('history')]);
  var historyBack = dom('button', { type: 'button', style: 'background:none;border:none;color:' + COLOR + ';cursor:pointer;font:inherit;font-size:12px;padding:2px 4px;' }, [T('backToChat')]);
  historyHead.appendChild(historyTitle);
  historyHead.appendChild(historyBack);
  var historyList = dom('div', { style: 'flex:1;overflow-y:auto;padding:4px 12px 8px;' });
  historyPane.appendChild(historyHead);
  historyPane.appendChild(historyList);

  box.appendChild(chatPane);
  box.appendChild(helpPane);
  box.appendChild(historyPane);

  function articleRow(a, compact) {
    var row = dom(a.url ? 'a' : 'div', {
      style:
        'display:block;padding:' + (compact ? '6px 0' : '10px 0') + ';border-bottom:1px solid rgba(0,0,0,0.06);color:#111;text-decoration:none;',
    });
    if (a.url) {
      row.setAttribute('href', a.url);
      row.setAttribute('target', '_blank');
      row.setAttribute('rel', 'noopener noreferrer');
    }
    row.appendChild(dom('div', { style: 'font-weight:600;font-size:13px;' }, [a.title || T('untitled')]));
    if (!compact && a.excerpt) {
      row.appendChild(dom('div', { style: 'font-size:12px;color:#666;margin-top:2px;line-height:1.4;' }, [a.excerpt]));
    }
    return row;
  }

  function fetchHelp(q) {
    return api('/api/chat/help?widgetId=' + encodeURIComponent(WIDGET_ID) + (q ? '&q=' + encodeURIComponent(q) : ''), { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function renderHelp(data, q) {
    helpList.innerHTML = '';
    var list = (data && data.articles) || [];
    if (!list.length) {
      helpList.appendChild(dom('p', { style: 'color:#666;font-size:13px;margin:12px 0;' }, [q ? T('noArticlesFound') : T('noArticles')]));
    }
    list.forEach(function (a) { helpList.appendChild(articleRow(a, false)); });
    if (data && data.helpCenterUrl) {
      helpFoot.innerHTML = '';
      helpFoot.appendChild(dom('a', { href: data.helpCenterUrl, target: '_blank', rel: 'noopener noreferrer', style: 'color:' + COLOR + ';' }, [T('helpCenter')]));
      helpFoot.style.display = 'block';
    }
  }

  var helpTimer = null;
  helpSearch.addEventListener('input', function () {
    if (helpTimer) clearTimeout(helpTimer);
    helpTimer = setTimeout(function () {
      var q = helpSearch.value.trim();
      fetchHelp(q).then(function (d) { renderHelp(d, q); });
    }, 250);
  });

  var helpLoaded = false;
  function showTab(which) {
    if (!HELP) return;
    var help = which === 'help';
    chatPane.style.display = help ? 'none' : 'flex';
    helpPane.style.display = help ? 'flex' : 'none';
    tabChat.setAttribute('aria-selected', help ? 'false' : 'true');
    tabHelp.setAttribute('aria-selected', help ? 'true' : 'false');
    tabChat.style.background = help ? 'none' : 'rgba(255,255,255,0.18)';
    tabHelp.style.background = help ? 'rgba(255,255,255,0.18)' : 'none';
    tabChat.style.opacity = help ? '0.75' : '1';
    tabHelp.style.opacity = help ? '1' : '0.75';
    if (help && !helpLoaded) {
      helpLoaded = true;
      fetchHelp('').then(function (d) { renderHelp(d, ''); });
    }
    if (help) helpSearch.focus();
  }
  if (HELP) {
    tabChat.addEventListener('click', function () { showTab('chat'); });
    tabHelp.addEventListener('click', function () { showTab('help'); });
  }

  // Mientras el visitante escribe su primera pregunta, artículos que coinciden.
  var suggestTimer = null;
  var lastSuggestQ = '';
  function suggestArticles() {
    if (!HELP) return;
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(function () {
      var q = input.value.trim();
      if (conversationId || q.length < 4) {
        suggestWrap.style.display = 'none';
        lastSuggestQ = '';
        return;
      }
      if (q === lastSuggestQ) return;
      lastSuggestQ = q;
      fetchHelp(q).then(function (d) {
        if (input.value.trim() !== q) return;
        var list = ((d && d.articles) || []).slice(0, 3);
        suggestWrap.innerHTML = '';
        if (!list.length) {
          suggestWrap.style.display = 'none';
          return;
        }
        suggestWrap.appendChild(dom('div', { style: 'color:#666;margin-bottom:2px;' }, [T('suggestions')]));
        list.forEach(function (a) { suggestWrap.appendChild(articleRow(a, true)); });
        suggestWrap.style.display = 'block';
      });
    }, 400);
  }
  var historyOpen = false;
  function historyBody() {
    var b = { widgetId: WIDGET_ID, visitorId: visitorId };
    if (identity.email && identity.userHash) {
      b.email = identity.email;
      b.userHash = identity.userHash;
    }
    return b;
  }
  function showHistory(on) {
    historyOpen = on;
    historyPane.style.display = on ? 'flex' : 'none';
    chatPane.style.display = on ? 'none' : 'flex';
    helpPane.style.display = 'none';
    historyBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) loadHistory();
    else input.focus();
  }
  function loadHistory() {
    historyTitle.textContent = T('history');
    historyList.innerHTML = '';
    historyList.appendChild(dom('p', { style: 'color:#666;font-size:13px;margin:12px 0;' }, [T('loading')]));
    api('/api/chat/history', { method: 'POST', body: JSON.stringify(historyBody()) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        historyList.innerHTML = '';
        var list = (d && d.conversations) || [];
        if (!d) {
          historyList.appendChild(dom('p', { role: 'alert', style: 'color:#b00020;font-size:13px;margin:12px 0;' }, [T('historyFailed')]));
          return;
        }
        if (!list.length) {
          historyList.appendChild(dom('p', { style: 'color:#666;font-size:13px;margin:12px 0;' }, [T('historyEmpty')]));
          return;
        }
        list.forEach(function (c) {
          var row = dom('button', {
            type: 'button',
            style: 'display:block;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid rgba(0,0,0,0.06);padding:10px 0;cursor:pointer;font:inherit;color:#111;',
          });
          var when = '';
          try { when = new Date(c.updated_at).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' }); } catch (e) {}
          var top = dom('div', { style: 'display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;' }, [
            dom('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, [c.subject || (c.last_sender === 'visitor' ? T('you') : T('team'))]),
            dom('span', { style: 'font-weight:400;color:#888;font-size:11px;flex-shrink:0;' }, [when + (c.status === 'resolved' ? ' · ' + T('closed') : '')]),
          ]);
          row.appendChild(top);
          row.appendChild(dom('div', { style: 'font-size:12px;color:#555;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, [c.last_body]));
          row.addEventListener('click', function () { openPast(c.id); });
          historyList.appendChild(row);
        });
      })
      .catch(function () {
        historyList.innerHTML = '';
        historyList.appendChild(dom('p', { role: 'alert', style: 'color:#b00020;font-size:13px;margin:12px 0;' }, [T('historyFailed')]));
      });
  }
  function openPast(id) {
    if (id === conversationId) {
      showHistory(false);
      return;
    }
    historyList.innerHTML = '';
    var body = historyBody();
    body.conversationId = id;
    api('/api/chat/history', { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.messages) {
          historyList.appendChild(dom('p', { role: 'alert', style: 'color:#b00020;font-size:13px;margin:12px 0;' }, [T('historyFailed')]));
          return;
        }
        historyTitle.textContent = d.conversation.subject || T('pastConversation');
        var back = dom('button', { type: 'button', style: 'background:none;border:none;color:' + COLOR + ';cursor:pointer;font:inherit;font-size:12px;padding:6px 0;' }, [T('allConversations')]);
        back.addEventListener('click', loadHistory);
        historyList.appendChild(back);
        d.messages.forEach(function (m) {
          var mine = m.sender_type === 'visitor';
          var wrap = dom('div', { style: 'display:flex;justify-content:' + (mine ? 'flex-end' : 'flex-start') + ';margin:6px 0;' });
          var bubble = dom('div', {
            style: 'max-width:80%;padding:8px 10px;border-radius:12px;font-size:13px;white-space:pre-wrap;word-break:break-word;background:' + (mine ? COLOR : '#f1f1f1') + ';color:' + (mine ? '#fff' : '#111') + ';',
          }, [m.body || '']);
          messageAttachments(m).forEach(function (a) {
            var el = renderAttachment(a);
            el.style.marginTop = '6px';
            bubble.appendChild(el);
          });
          wrap.appendChild(bubble);
          historyList.appendChild(wrap);
        });
        historyList.appendChild(dom('p', { style: 'color:#888;font-size:11px;margin:10px 0 0;' }, [T('writeToContinue')]));
      })
      .catch(function () {});
  }
  historyBtn.addEventListener('click', function () { showHistory(!historyOpen); });
  historyBack.addEventListener('click', function () { showHistory(false); });

  // ---------- Mensajes salientes y encuestas ----------
  var obCard = dom('div', {
    role: 'dialog',
    'aria-live': 'polite',
    style:
      'position:fixed;bottom:88px;' + (POSITION === 'bottom-left' ? 'left:20px;' : 'right:20px;') +
      'width:300px;max-width:calc(100vw - 40px);background:#fff;color:#111;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);border:1px solid rgba(0,0,0,0.08);padding:14px;display:none;box-sizing:border-box;',
  });
  var obShown = null;
  function obSeenList() {
    try { return JSON.parse(localStorage.getItem(OB_SEEN_KEY) || '[]'); } catch (e) { return []; }
  }
  function obMarkSeen(id) {
    var list = obSeenList();
    if (list.indexOf(id) < 0) list.push(id);
    try { localStorage.setItem(OB_SEEN_KEY, JSON.stringify(list.slice(-50))); } catch (e) {}
  }
  function obUrlMatches(m) {
    if (m.urlMatch === 'any' || !m.urlValue) return true;
    var u = String(location.href).split('#')[0].toLowerCase();
    var v = String(m.urlValue).trim().toLowerCase();
    if (m.urlMatch === 'equals') return u.replace(/[/]$/, '') === v.replace(/[/]$/, '');
    return u.indexOf(v) >= 0;
  }
  function obAudience(m) {
    if (m.audience === 'new') return !firstSeenAt;
    if (m.audience === 'returning') return !!firstSeenAt && Date.now() - firstSeenAt > 30 * 60 * 1000;
    if (m.audience === 'identified') return !!identity.email;
    return true;
  }
  function obEvent(m, event, extra) {
    var b = { widgetId: WIDGET_ID, visitorId: visitorId, outboundId: m.id, event: event };
    for (var k in extra || {}) b[k] = extra[k];
    return api('/api/chat/outbound', { method: 'POST', body: JSON.stringify(b) });
  }
  function obClose() {
    obCard.style.display = 'none';
    obShown = null;
  }
  function obRender(m) {
    obCard.innerHTML = '';
    var x = dom('button', { type: 'button', 'aria-label': T('close'), style: 'float:right;background:none;border:none;color:#888;cursor:pointer;font-size:16px;line-height:1;padding:0 0 0 8px;' }, ['×']);
    x.addEventListener('click', obClose);
    obCard.appendChild(x);
    if (m.from) obCard.appendChild(dom('div', { style: 'font-size:12px;font-weight:600;color:#555;margin-bottom:4px;' }, [m.from]));
    obCard.appendChild(dom('p', { style: 'margin:0 0 10px;white-space:pre-wrap;word-break:break-word;font-size:14px;' }, [m.body]));
    if (m.kind === 'survey') {
      var score = 0;
      var stars = dom('div', { style: 'display:flex;gap:4px;margin-bottom:8px;', role: 'radiogroup', 'aria-label': m.body });
      var comment = dom('textarea', { rows: '2', placeholder: T('csatComment'), style: 'width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:6px 8px;font-size:12px;margin-bottom:8px;resize:none;font-family:inherit;' });
      var sendBtn = dom('button', { type: 'button', style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;opacity:0.4;' }, [T('csatSend')]);
      var paint = function () {
        stars.innerHTML = '';
        for (var i = 1; i <= 5; i++) {
          (function (n) {
            var b = dom('button', { type: 'button', role: 'radio', 'aria-checked': n === score ? 'true' : 'false', 'aria-label': T('stars', { n: n }), style: 'background:none;border:none;cursor:pointer;font-size:20px;padding:0 2px;line-height:1;color:' + (n <= score ? COLOR : '#bbb') + ';' }, [n <= score ? '★' : '☆']);
            b.addEventListener('click', function () { score = n; sendBtn.style.opacity = '1'; paint(); });
            stars.appendChild(b);
          })(i);
        }
      };
      paint();
      sendBtn.addEventListener('click', function () {
        if (!score) return;
        obEvent(m, 'survey', { score: score, comment: comment.value.trim() || undefined })
          .then(function () {
            obCard.innerHTML = '';
            obCard.appendChild(dom('p', { style: 'margin:0;font-size:14px;' }, [T('csatThanks')]));
            setTimeout(obClose, 2500);
          })
          .catch(function () {});
      });
      obCard.appendChild(stars);
      obCard.appendChild(comment);
      obCard.appendChild(sendBtn);
    } else {
      var reply = dom('button', { type: 'button', style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;' }, [T('reply')]);
      reply.addEventListener('click', function () {
        pendingOutbound = m;
        obClose();
        openChat();
      });
      obCard.appendChild(reply);
    }
    obCard.style.display = 'block';
  }
  var obMessages = [];
  var obTimer = null;
  var obUrl = '';
  function obEvaluate() {
    obUrl = String(location.href);
    if (obTimer) { clearTimeout(obTimer); obTimer = null; }
    if (obShown || open) return;
    var seenIds = obSeenList();
    for (var i = 0; i < obMessages.length; i++) {
      var m = obMessages[i];
      if (seenIds.indexOf(m.id) >= 0) continue;
      // Un mensaje para empezar a chatear no interrumpe una conversación en curso.
      if (m.kind === 'chat' && conversationId) continue;
      if (!obUrlMatches(m) || !obAudience(m)) continue;
      (function (msg) {
        obTimer = setTimeout(function () {
          if (open || obShown || String(location.href) !== obUrl) return;
          obShown = msg;
          obMarkSeen(msg.id);
          obEvent(msg, 'seen').catch(function () {});
          obRender(msg);
        }, Math.max(0, Number(msg.delaySeconds) || 0) * 1000);
      })(m);
      return;
    }
  }
  api('/api/chat/outbound?widgetId=' + encodeURIComponent(WIDGET_ID), { method: 'GET' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      obMessages = (d && d.messages) || [];
      if (obMessages.length) {
        visitorReady.then(obEvaluate);
        // Sitios de una sola página: la URL cambia sin recargar.
        setInterval(function () { if (String(location.href) !== obUrl) obEvaluate(); }, 1500);
      }
    })
    .catch(function () {});

  root.appendChild(obCard);
  root.appendChild(btn);
  root.appendChild(box);

  function renderAttachment(a) {
    var url = safeUrl(a.url);
    if (!url) return dom('span', { style: 'font-size:12px;' }, ['📎 ' + (a.name || 'file')]);
    if (a.type === 'image') {
      return dom('a', { href: url, target: '_blank', rel: 'noopener noreferrer', style: 'display:block;max-width:200px;' }, [
        dom('img', { src: url, alt: a.name, style: 'max-width:100%;max-height:160px;border-radius:8px;display:block;' }),
      ]);
    }
    if (a.type === 'audio') {
      return dom('audio', { src: url, controls: true, preload: 'metadata', style: 'max-width:220px;display:block;' });
    }
    return dom('a', {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      style:
        'display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:8px;color:#111;text-decoration:none;font-size:12px;max-width:240px;',
    }, ['📎 ' + a.name + ' (' + formatBytes(a.size) + ')']);
  }

  function appendMessage(m) {
    var from = m.sender_type || 'visitor';
    var isVisitor = from === 'visitor';
    var wrap = dom('div', { style: 'display:flex;justify-content:' + (isVisitor ? 'flex-end' : 'flex-start') + ';margin-bottom:10px;' });
    var bubble = dom('div', {
      style:
        'max-width:80%;padding:10px 12px;border-radius:12px;background:' +
        (isVisitor ? COLOR : '#fff') +
        ';color:' +
        (isVisitor ? '#fff' : '#111') +
        ';box-shadow:0 1px 2px rgba(0,0,0,0.05);',
    });

    if (m.body) {
      var p = dom('p', { style: 'margin:0 0 4px;white-space:pre-wrap;word-break:break-word;' }, [m.body]);
      bubble.appendChild(p);
    }
    if (m.edited_at) {
      bubble.appendChild(dom('div', { style: 'font-size:10px;opacity:0.6;margin-top:2px;' }, [T('edited')]));
    }
    // Lo que ya se mostró y su versión: si el agente edita o borra, el poll re-dibuja.
    if (m.id) renderedEdits[m.id] = m.edited_at || '';
    var attachments = messageAttachments(m);
    attachments.forEach(function (a) {
      var el = renderAttachment(a);
      el.style.marginTop = '6px';
      bubble.appendChild(el);
    });

    if (isVisitor && m.id) visitorBubbles[m.id] = bubble;
    if (isVisitor && m.read_at) markBubbleRead(m.id, bubble);

    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function markBubbleRead(id, bubble) {
    if (bubble.getAttribute('data-read')) return;
    bubble.setAttribute('data-read', '1');
    bubble.appendChild(dom('div', {
      style: 'font-size:10px;opacity:0.8;text-align:right;margin-top:4px;',
    }, [T('read')]));
    if (id) messageReadMap[id] = true;
  }

  // El poll trae read_at de mensajes ya mostrados: se marca la burbuja existente.
  function updateReadReceipts(list) {
    (list || []).forEach(function (m) {
      if (m.sender_type === 'visitor' && m.read_at && m.id && visitorBubbles[m.id]) {
        markBubbleRead(m.id, visitorBubbles[m.id]);
      }
    });
  }

  function showWelcome() {
    if (pendingOutbound && pendingOutbound.kind === 'chat') {
      appendMessage({ body: pendingOutbound.body, sender_type: 'agent' });
      return;
    }
    appendMessage({ body: WELCOME, sender_type: 'agent' });
  }

  function updateAway(office) {
    if (!office || !office.enabled || office.open) {
      awayBanner.style.display = 'none';
      return;
    }
    var msg = T('away');
    if (office.nextOpenAt) {
      try {
        msg +=
          ' ' +
          T('backAt', {
            when: new Date(office.nextOpenAt).toLocaleString(LOCALE, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          });
      } catch (e) {}
    }
    awayBanner.textContent = msg;
    awayBanner.style.display = 'block';
  }

  var csatScore = 0;
  var csatConversationId = null;
  var csatSubmitted = false;

  function renderStars() {
    csatStars.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var star = dom(
          'button',
          {
            type: 'button',
            'aria-label': T('stars', { n: n }),
            style:
              'background:none;border:none;cursor:pointer;font-size:20px;padding:0 2px;line-height:1;color:' +
              (n <= csatScore ? COLOR : '#bbb') +
              ';',
          },
          [n <= csatScore ? '★' : '☆'],
        );
        star.addEventListener('click', function () {
          csatScore = n;
          csatSend.style.opacity = '1';
          renderStars();
        });
        csatStars.appendChild(star);
      })(i);
    }
  }
  renderStars();

  function resetCsat(conversationId) {
    csatConversationId = conversationId;
    csatScore = 0;
    csatSubmitted = false;
    csatComment.value = '';
    csatSend.style.opacity = '0.4';
    csatQuestion.textContent = T('csatQuestion');
    csatStars.style.display = 'flex';
    csatComment.style.display = 'block';
    csatSend.style.display = 'inline-block';
    renderStars();
    csatWrap.style.display = 'block';
  }

  function updateCsat(csat) {
    if (csatSubmitted) return;
    if (!csat || !csat.conversationId) {
      csatWrap.style.display = 'none';
      csatConversationId = null;
      return;
    }
    if (csat.conversationId !== csatConversationId) resetCsat(csat.conversationId);
  }

  csatSend.addEventListener('click', function () {
    if (!csatScore || !csatConversationId) return;
    api('/api/chat/csat', {
      method: 'POST',
      body: JSON.stringify({
        widgetId: WIDGET_ID,
        visitorId: visitorId,
        conversationId: csatConversationId,
        score: csatScore,
        comment: csatComment.value.trim() || undefined,
      }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        csatSubmitted = true;
        csatStars.style.display = 'none';
        csatComment.style.display = 'none';
        csatSend.style.display = 'none';
        csatQuestion.textContent = T('csatThanks');
      })
      .catch(function () {});
  });

  function buildForm() {
    if (!FIELDS.length) return null;
    formWrap.innerHTML = '';
    formWrap.style.display = 'block';
    var inputs = [];
    FIELDS.forEach(function (f) {
      var label = dom('label', { style: 'display:block;margin-bottom:8px;font-size:12px;color:#555;' }, [f.name]);
      var inp = dom('input', {
        type: f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text',
        required: f.required,
        'data-id': f.id,
        style: 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(0,0,0,0.1);border-radius:8px;margin-bottom:10px;',
      });
      formWrap.appendChild(label);
      formWrap.appendChild(inp);
      inputs.push({ id: f.id, el: inp, required: f.required });
    });
    var submit = dom('button', { style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;width:100%;' }, [T('startChat')]);
    formWrap.appendChild(submit);
    return { inputs: inputs, submit: submit };
  }

  function updatePreview() {
    if (!selectedFile) {
      previewWrap.style.display = 'none';
      previewBody.innerHTML = '';
      fileInput.value = '';
      return;
    }
    previewWrap.style.display = 'flex';
    previewBody.innerHTML = '';
    previewBody.appendChild(document.createTextNode('📎 ' + selectedFile.name + ' (' + formatBytes(selectedFile.size) + ')'));
    if (selectedFile.size > MAX_FILE_SIZE) {
      var warn = dom('span', { style: 'color:#b00020;display:block;margin-top:2px;' }, [T('fileTooLarge')]);
      previewBody.appendChild(warn);
    }
  }

  function clearPreview() {
    selectedFile = null;
    updatePreview();
  }

  function showUploadError(msg) {
    previewBody.appendChild(dom('span', { role: 'alert', style: 'color:#b00020;display:block;margin-top:2px;' }, [msg]));
  }

  function loadMessages() {
    api('/api/chat/messages?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data) return;
        updateAway(data.office);
        updateCsat(data.csat);
        if (!data.visitor) {
          if (!messages.childNodes.length && formWrap.style.display === 'none') showWelcome();
          return;
        }
        conversationId = data.conversation ? data.conversation.id : null;
        // Con una conversación abierta el formulario pre-chat ya se completó.
        if (conversationId) formWrap.style.display = 'none';
        if (!conversationId) {
          messages.innerHTML = '';
          visitorBubbles = {};
          renderedEdits = {};
          showWelcome();
        } else {
          renderAll(data.messages);
          markRead();
        }
      })
      .catch(function () {});
  }

  function renderAll(list) {
    messages.innerHTML = '';
    visitorBubbles = {};
    renderedEdits = {};
    (list || []).forEach(function (m) {
      appendMessage(m);
      if (m.id) lastMessageId = m.id;
    });
  }

  // Un mensaje ya mostrado que el agente editó o borró (o el último visto
  // que ya no está): hay que re-dibujar el hilo en vez de sumar al final.
  function threadChanged(list) {
    var present = {};
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.id) continue;
      present[m.id] = true;
      if (Object.prototype.hasOwnProperty.call(renderedEdits, m.id) && renderedEdits[m.id] !== (m.edited_at || '')) return true;
    }
    for (var id in renderedEdits) {
      if (Object.prototype.hasOwnProperty.call(renderedEdits, id) && !present[id]) return true;
    }
    return false;
  }

  function poll() {
    if (!conversationId || !open) return;
    api('/api/chat/messages?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.messages) return;
        updateAway(data.office);
        updateCsat(data.csat);
        if (threadChanged(data.messages)) {
          renderAll(data.messages);
          markRead();
          pollTyping();
          return;
        }
        var newMessages = data.messages;
        if (lastMessageId) {
          var seen = false;
          newMessages = newMessages.filter(function (m) {
            if (m.id === lastMessageId) {
              seen = true;
              return false;
            }
            return seen;
          });
        }
        updateReadReceipts(data.messages);
        newMessages.forEach(function (m) {
          appendMessage(m);
          lastMessageId = m.id;
        });
        markRead();
        pollTyping();
      })
      .catch(function () {});
  }

  function markRead() {
    if (!conversationId) return;
    api('/api/chat/read', {
      method: 'POST',
      body: JSON.stringify({ widgetId: WIDGET_ID, visitorId: visitorId, conversationId: conversationId }),
    }).catch(function () {});
  }

  function sendTyping() {
    if (!conversationId) return;
    var now = Date.now();
    if (now - lastTypingAt < 2000) return;
    lastTypingAt = now;
    api('/api/chat/typing', {
      method: 'POST',
      body: JSON.stringify({ widgetId: WIDGET_ID, visitorId: visitorId, conversationId: conversationId }),
    }).catch(function () {});
  }

  function pollTyping() {
    if (!conversationId) return;
    api('/api/chat/typing?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId) + '&conversationId=' + encodeURIComponent(conversationId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var typing = (data.typing || []).filter(function (t) { return t.sender_type === 'user'; });
        typingIndicator.style.display = typing.length > 0 ? 'flex' : 'none';
      })
      .catch(function () {});
  }

  function showSendError(msg, body) {
    // Se devuelve el texto al input (si el visitante no escribió otra cosa).
    if (body && !input.value) input.value = body;
    sendError.textContent = msg;
    sendError.style.display = 'block';
  }

  // Después de resolver, el widget sigue mostrando la conversación cerrada; si
  // el visitante escribe, el server abre una nueva y el hilo empieza de cero.
  function adoptConversation(conv) {
    if (!conv) return;
    if (conversationId && conv.id !== conversationId) {
      messages.innerHTML = '';
      visitorBubbles = {};
      renderedEdits = {};
      lastMessageId = null;
    }
    conversationId = conv.id;
  }

  function sendMessage(body) {
    // El formulario pre-chat todavía está creando la conversación: esperar, si
    // no se crean dos conversaciones (o choca el alta del visitante).
    if (formRequest) {
      var waiting = formRequest;
      waiting.then(function () {
        if (formRequest === waiting) formRequest = null;
        sendMessage(body);
      });
      return;
    }
    sendError.style.display = 'none';
    if (selectedFile) {
      sendFile(selectedFile, body);
      return;
    }
    if (!body) return;
    var payload = withIdentity({ widgetId: WIDGET_ID, visitorId: visitorId, body: body });
    if (pendingOutbound && !conversationId) payload.outboundId = pendingOutbound.id;
    api('/api/chat/messages', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        var data = res.data;
        if (!res.ok || !data) {
          showSendError(
            res.status === 429
              ? T('tooMany')
              : res.status === 400 && body.length > MAX_MESSAGE
                ? T('tooLong', { max: MAX_MESSAGE })
                : T('sendFailed'),
            body,
          );
          return;
        }
        adoptConversation(data.conversation);
        pendingOutbound = null;
        appendMessage({ id: data.message && data.message.id, body: body, sender_type: 'visitor', read_at: data.message && data.message.read_at });
        if (data.message && data.message.id) lastMessageId = data.message.id;
        if (data.bot) {
          appendMessage(data.bot);
          if (data.bot.id) lastMessageId = data.bot.id;
        }
      })
      .catch(function () {
        showSendError(T('sendFailed'), body);
      });
  }

  function sendFile(file, text) {
    if (uploading) return;
    uploading = true;
    var formData = new FormData();
    formData.append('widgetId', WIDGET_ID);
    formData.append('visitorId', visitorId);
    formData.append('file', file);
    if (text) formData.append('body', text);
    if (identity.email) formData.append('email', identity.email);
    if (identity.name) formData.append('name', identity.name);
    if (identity.email && identity.userHash) formData.append('userHash', identity.userHash);
    formData.append('context', JSON.stringify(pageContext()));

    api('/api/chat/messages/upload', { method: 'POST', body: formData })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        uploading = false;
        var data = res.data;
        if (!res.ok || !data || !data.message) {
          // Se conserva la vista previa para que el visitante pueda reintentar.
          showUploadError(
            res.status === 413
              ? T('fileTooLarge')
              : res.status === 415
                ? T('fileType')
                : T('fileFailed'),
          );
          return;
        }
        clearPreview();
        adoptConversation(data.conversation);
        appendMessage({ id: data.message.id, body: data.message.body || '', sender_type: 'visitor', attachments: messageAttachments(data.message) });
        if (data.message.id) lastMessageId = data.message.id;
        if (data.bot) {
          appendMessage(data.bot);
          if (data.bot.id) lastMessageId = data.bot.id;
        }
      })
      .catch(function () {
        uploading = false;
        showUploadError(T('fileFailed'));
      });
  }

  function openChat() {
    open = true;
    obClose();
    if (historyOpen) showHistory(false);
    box.style.display = 'flex';
    btn.setAttribute('aria-label', T('closeChat'));
    messages.innerHTML = '';
    loadMessages();
    if (!pollTimer) pollTimer = setInterval(poll, 5000);
  }

  function closeChat() {
    open = false;
    box.style.display = 'none';
    btn.setAttribute('aria-label', T('openChat'));
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function toggle() {
    if (open) closeChat(); else openChat();
  }

  btn.addEventListener('click', function () { visitorReady.then(toggle); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (open) {
      closeChat();
      try { btn.focus(); } catch (err) {}
    } else if (obShown) {
      obClose();
    }
  });
  closeBtn.addEventListener('click', closeChat);
  send.addEventListener('click', function () {
    var v = input.value.trim();
    if (!v && !selectedFile) return;
    input.value = '';
    suggestWrap.style.display = 'none';
    sendMessage(v);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send.click();
  });
  input.addEventListener('input', sendTyping);
  input.addEventListener('input', suggestArticles);
  attachBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    updatePreview();
  });
  previewRemove.addEventListener('click', clearPreview);

  var form = buildForm();
  if (form) {
    form.submit.addEventListener('click', function () {
      var answers = {};
      var valid = true;
      form.inputs.forEach(function (item) {
        var val = item.el.value.trim();
        if (item.required && !val) valid = false;
        answers[item.id] = val;
      });
      if (!valid) return;
      formWrap.style.display = 'none';
      showWelcome();
      // Las respuestas se guardan en el server con las etiquetas de cada campo.
      formRequest = api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(withIdentity(pendingOutbound ? { widgetId: WIDGET_ID, visitorId: visitorId, fields: answers, outboundId: pendingOutbound.id } : { widgetId: WIDGET_ID, visitorId: visitorId, fields: answers })),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          // Sin conversationId el polling no arranca y no llegan las respuestas del agente.
          if (data.conversation) {
            conversationId = data.conversation.id;
            pendingOutbound = null;
          }
          if (data.message) {
            appendMessage(data.message);
            if (data.message.id) lastMessageId = data.message.id;
          }
          if (data.bot) {
            appendMessage(data.bot);
            if (data.bot.id) lastMessageId = data.bot.id;
          }
        })
        .catch(function () {})
        .then(function () { formRequest = null; });
    });
  } else {
    showWelcome();
  }

  document.body.appendChild(root);

  // Link del email de respuestas sin leer: la página con #zs-chat abre el chat.
  try {
    if (location.hash === '#zs-chat') visitorReady.then(openChat);
  } catch (e) {}
})();`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return new NextResponse('/* missing widget id */', { status: 400, headers: { 'content-type': 'application/javascript' } });

  const widget = await getChatWidget(id);
  if (!widget) return new NextResponse('/* widget not found */', { status: 404, headers: { 'content-type': 'application/javascript' } });

  const origin = new URL(req.url).origin;
  return new NextResponse(buildScript(widget, origin), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}
