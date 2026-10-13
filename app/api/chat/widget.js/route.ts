import { NextResponse } from 'next/server';
import { getChatWidget } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

function buildScript(widget: Awaited<ReturnType<typeof getChatWidget>>, origin: string) {
  const id = widget!.id;
  const color = widget!.color;
  const position = widget!.position;
  const welcomeMessage = widget!.welcome_message || 'Hi there. How can we help?';
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
  var WELCOME = ${JSON.stringify(welcomeMessage)};
  var FIELDS = ${JSON.stringify(fields)};
  var ORIGIN = ${JSON.stringify(origin)};
  var STORAGE_KEY = 'zs_chat_visitor_' + WIDGET_ID;
  var MAX_FILE_SIZE = 10 * 1024 * 1024;

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function getVisitorId() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v) return v;
    } catch (e) {}
    var id = uuid();
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {}
    return id;
  }

  function api(path, opts) {
    return fetch(ORIGIN + path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts));
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  // Identidad opcional del visitante (p. ej. la persona logueada en el sitio
  // que embebe el widget). Se declara antes de cargar con
  // window.zsChatSettings = { email, name } o data-email / data-name en el
  // <script>, o después con window.zsChat.identify({ email, name }). Es
  // información declarada por la página (no verificada): solo completa el
  // email y el nombre del visitante en el inbox.
  var SCRIPT_EL = document.currentScript;
  var identity = { email: null, name: null };
  function cleanIdentity(o) {
    if (!o || typeof o !== 'object') return;
    if (typeof o.email === 'string') {
      var e = o.email.trim().slice(0, 254);
      if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) identity.email = e;
    }
    if (typeof o.name === 'string') {
      var n = o.name.replace(/[\\u0000-\\u001f]/g, '').trim().slice(0, 120);
      if (n) identity.name = n;
    }
  }
  if (SCRIPT_EL && SCRIPT_EL.getAttribute) {
    cleanIdentity({ email: SCRIPT_EL.getAttribute('data-email'), name: SCRIPT_EL.getAttribute('data-name') });
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
    return payload;
  }

  var visitorId = getVisitorId();
  var open = false;
  var conversationId = null;
  var lastMessageId = null;
  var pollTimer = null;
  var typingTimer = null;
  var lastTypingAt = 0;
  var selectedFile = null;
  var uploading = false;
  var messageReadMap = {};

  var root = dom('div', {
    id: 'zs-chat-root',
    style:
      'position:fixed;z-index:99999;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.4;',
  });

  var btn = dom('button', {
    id: 'zs-chat-btn',
    'aria-label': 'Open chat',
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
  header.appendChild(dom('span', {}, ['Chat']));
  var closeBtn = dom('button', { style: 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;', 'aria-label': 'Close' }, ['×']);
  header.appendChild(closeBtn);

  var messages = dom('div', { style: 'flex:1;overflow-y:auto;padding:16px;background:#f8f8f8;' });

  var awayBanner = dom('div', {
    style:
      'display:none;padding:10px 16px;background:#f5f5f5;color:#444;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.06);',
  });

  var csatWrap = dom('div', {
    style: 'display:none;padding:14px 16px;background:#fff;border-top:1px solid rgba(0,0,0,0.06);',
  });
  var csatQuestion = dom('p', { style: 'margin:0 0 8px;font-size:13px;font-weight:600;color:#111;' }, ['How would you rate your experience?']);
  var csatStars = dom('div', { style: 'display:flex;gap:4px;margin-bottom:8px;' });
  var csatComment = dom('textarea', {
    placeholder: 'Anything to add? (optional)',
    rows: '2',
    style:
      'width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:6px 8px;font-size:12px;margin-bottom:8px;resize:none;font-family:inherit;',
  });
  var csatSend = dom('button', {
    type: 'button',
    style:
      'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;opacity:0.4;',
  }, ['Send feedback']);
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
    'aria-label': 'Remove file',
  }, ['×']);
  previewWrap.appendChild(previewBody);
  previewWrap.appendChild(previewRemove);

  var inputWrap = dom('div', { style: 'padding:12px;border-top:1px solid rgba(0,0,0,0.06);background:#fff;display:flex;gap:8px;align-items:center;' });
  var attachBtn = dom('button', {
    type: 'button',
    style:
      'background:none;border:none;color:#666;cursor:pointer;font-size:18px;line-height:1;padding:4px;',
    'aria-label': 'Attach file',
    title: 'Attach file',
  }, ['⊕']);
  var fileInput = dom('input', { type: 'file', style: 'display:none;' });
  var input = dom('input', {
    type: 'text',
    placeholder: 'Type a message…',
    style: 'flex:1;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px 10px;outline:none;',
  });
  var send = dom('button', {
    type: 'button',
    style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:500;',
    'aria-label': 'Send',
  }, ['Send']);
  inputWrap.appendChild(attachBtn);
  inputWrap.appendChild(fileInput);
  inputWrap.appendChild(input);
  inputWrap.appendChild(send);

  var formWrap = dom('div', { style: 'padding:16px;border-bottom:1px solid rgba(0,0,0,0.06);background:#fff;display:none;' });

  box.appendChild(header);
  box.appendChild(formWrap);
  box.appendChild(awayBanner);
  box.appendChild(messages);
  box.appendChild(csatWrap);
  box.appendChild(typingIndicator);
  box.appendChild(previewWrap);
  box.appendChild(inputWrap);
  root.appendChild(btn);
  root.appendChild(box);

  function renderAttachment(a) {
    if (a.type === 'image') {
      return dom('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', style: 'display:block;max-width:200px;' }, [
        dom('img', { src: a.url, alt: a.name, style: 'max-width:100%;max-height:160px;border-radius:8px;display:block;' }),
      ]);
    }
    if (a.type === 'audio') {
      return dom('audio', { src: a.url, controls: true, preload: 'metadata', style: 'max-width:220px;display:block;' });
    }
    return dom('a', {
      href: a.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      style:
        'display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:8px;color:#111;text-decoration:none;font-size:12px;max-width:240px;',
    }, ['📎 ' + escapeHtml(a.name) + ' (' + formatBytes(a.size) + ')']);
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
    var attachments = Array.isArray(m.attachments) ? m.attachments : [];
    attachments.forEach(function (a) {
      var el = renderAttachment(a);
      el.style.marginTop = '6px';
      bubble.appendChild(el);
    });

    if (isVisitor && m.read_at) {
      var readLabel = dom('div', {
        style: 'font-size:10px;opacity:0.8;text-align:right;margin-top:4px;',
      }, ['Read']);
      bubble.appendChild(readLabel);
      if (m.id) messageReadMap[m.id] = true;
    }

    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function showWelcome() {
    appendMessage({ body: WELCOME, sender_type: 'agent' });
  }

  function updateAway(office) {
    if (!office || !office.enabled || office.open) {
      awayBanner.style.display = 'none';
      return;
    }
    var msg = "We're away right now.";
    if (office.nextOpenAt) {
      try {
        msg +=
          ' Back ' +
          new Date(office.nextOpenAt).toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }) +
          '.';
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
            'aria-label': n + ' stars',
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
    csatQuestion.textContent = 'How would you rate your experience?';
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
        csatQuestion.textContent = 'Thanks for your feedback!';
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
    var submit = dom('button', { style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;width:100%;' }, ['Start chat']);
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
      var warn = dom('span', { style: 'color:#b00020;display:block;margin-top:2px;' }, ['File too large (max 10 MB)']);
      previewBody.appendChild(warn);
    }
  }

  function clearPreview() {
    selectedFile = null;
    updatePreview();
  }

  function loadMessages() {
    api('/api/chat/messages?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data) return;
        updateAway(data.office);
        updateCsat(data.csat);
        if (!data.visitor) return;
        conversationId = data.conversation ? data.conversation.id : null;
        messages.innerHTML = '';
        if (!conversationId) showWelcome();
        else {
          data.messages.forEach(function (m) {
            appendMessage(m);
            if (m.id) lastMessageId = m.id;
          });
          markRead();
        }
      })
      .catch(function () {});
  }

  function poll() {
    if (!conversationId || !open) return;
    api('/api/chat/messages?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.messages) return;
        updateAway(data.office);
        updateCsat(data.csat);
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

  function sendMessage(body) {
    if (selectedFile) {
      sendFile(selectedFile, body);
      return;
    }
    if (!body) return;
    var payload = withIdentity({ widgetId: WIDGET_ID, visitorId: visitorId, body: body });
    api('/api/chat/messages', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.conversation) conversationId = data.conversation.id;
        appendMessage({ body: body, sender_type: 'visitor' });
        if (data.message && data.message.id) lastMessageId = data.message.id;
        if (data.bot) {
          appendMessage(data.bot);
          if (data.bot.id) lastMessageId = data.bot.id;
        }
      })
      .catch(function () {});
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

    api('/api/chat/messages/upload', { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        uploading = false;
        clearPreview();
        if (data.conversation) conversationId = data.conversation.id;
        var attachments = Array.isArray(data.message.attachments) ? data.message.attachments : [];
        appendMessage({ body: data.message.body || '', sender_type: 'visitor', attachments: attachments });
        if (data.message && data.message.id) lastMessageId = data.message.id;
        if (data.bot) {
          appendMessage(data.bot);
          if (data.bot.id) lastMessageId = data.bot.id;
        }
      })
      .catch(function () {
        uploading = false;
      });
  }

  function openChat() {
    open = true;
    box.style.display = 'flex';
    btn.setAttribute('aria-label', 'Close chat');
    messages.innerHTML = '';
    loadMessages();
    if (!pollTimer) pollTimer = setInterval(poll, 5000);
  }

  function closeChat() {
    open = false;
    box.style.display = 'none';
    btn.setAttribute('aria-label', 'Open chat');
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function toggle() {
    if (open) closeChat(); else openChat();
  }

  btn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', closeChat);
  send.addEventListener('click', function () {
    var v = input.value.trim();
    if (!v && !selectedFile) return;
    input.value = '';
    sendMessage(v);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send.click();
  });
  input.addEventListener('input', sendTyping);
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
      api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(withIdentity({ widgetId: WIDGET_ID, visitorId: visitorId, body: 'Started chat', fields: answers })),
      }).catch(function () {});
      formWrap.style.display = 'none';
      showWelcome();
    });
  } else {
    showWelcome();
  }

  document.body.appendChild(root);
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
