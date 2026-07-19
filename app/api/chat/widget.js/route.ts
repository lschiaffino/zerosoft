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

  var visitorId = getVisitorId();
  var open = false;
  var conversationId = null;
  var lastMessageId = null;
  var pollTimer = null;

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

  var inputWrap = dom('div', { style: 'padding:12px;border-top:1px solid rgba(0,0,0,0.06);background:#fff;display:flex;gap:8px;' });
  var input = dom('input', {
    type: 'text',
    placeholder: 'Type a message…',
    style: 'flex:1;border:1px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px 10px;outline:none;',
  });
  var send = dom('button', { style: 'background:' + COLOR + ';color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:500;', 'aria-label': 'Send' }, ['Send']);
  inputWrap.appendChild(input);
  inputWrap.appendChild(send);

  var formWrap = dom('div', { style: 'padding:16px;border-bottom:1px solid rgba(0,0,0,0.06);background:#fff;display:none;' });

  box.appendChild(header);
  box.appendChild(formWrap);
  box.appendChild(messages);
  box.appendChild(inputWrap);
  root.appendChild(btn);
  root.appendChild(box);

  function appendMessage(text, from, createdAt) {
    var isVisitor = from === 'visitor';
    var wrap = dom('div', { style: 'display:flex;justify-content:' + (isVisitor ? 'flex-end' : 'flex-start') + ';margin-bottom:10px;' });
    var bubble = dom('div', {
      style:
        'max-width:80%;padding:10px 12px;border-radius:12px;background:' +
        (isVisitor ? COLOR : '#fff') +
        ';color:' +
        (isVisitor ? '#fff' : '#111') +
        ';box-shadow:0 1px 2px rgba(0,0,0,0.05);',
    }, [text]);
    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function showWelcome() {
    appendMessage(WELCOME, 'agent');
  }

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

  function loadMessages() {
    api('/api/chat/messages?widgetId=' + encodeURIComponent(WIDGET_ID) + '&visitorId=' + encodeURIComponent(visitorId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.visitor) return;
        conversationId = data.conversation ? data.conversation.id : null;
        messages.innerHTML = '';
        if (!conversationId) showWelcome();
        else {
          data.messages.forEach(function (m) {
            appendMessage(m.body, m.sender_type, m.created_at);
            if (m.id) lastMessageId = m.id;
          });
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
          appendMessage(m.body, m.sender_type, m.created_at);
          lastMessageId = m.id;
        });
      })
      .catch(function () {});
  }

  function sendMessage(body) {
    var payload = { widgetId: WIDGET_ID, visitorId: visitorId, body: body };
    api('/api/chat/messages', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.conversation) conversationId = data.conversation.id;
        appendMessage(body, 'visitor');
        if (data.message && data.message.id) lastMessageId = data.message.id;
      })
      .catch(function () {});
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
    if (!v) return;
    input.value = '';
    sendMessage(v);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send.click();
  });

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
        body: JSON.stringify({ widgetId: WIDGET_ID, visitorId: visitorId, body: 'Started chat', fields: answers }),
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
