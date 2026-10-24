/*
 * Content script de Gmail: panel lateral con el contacto del remitente del
 * email abierto (deals, tareas, crear contacto, crear tarea, registrar el
 * email) y casilla "Registrar y trackear" en cada ventana de redacción.
 * Todas las llamadas a la API pasan por el service worker (background.js).
 * El DOM de Gmail se lee con los mismos atributos que usa Gmail web:
 * div.adn[data-legacy-message-id], span.gD[email] (remitente), span.g2[email]
 * (destinatarios), h2.hP (asunto), div.a3s (cuerpo).
 */
(function () {
  'use strict';
  if (window.__zsCrmLoaded) return;
  window.__zsCrmLoaded = true;

  var Z = window.ZsShared;
  var locale = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || 'en';

  function t(key, subs) {
    var s = '';
    try {
      s = chrome.i18n.getMessage(key, subs);
    } catch (e) {
      s = '';
    }
    return s || key;
  }

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError || !res) resolve({ ok: false, error: 'extension_error' });
          else resolve(res);
        });
      } catch (e) {
        // La extensión se actualizó y este content script quedó huérfano.
        resolve({ ok: false, error: 'extension_reloaded' });
      }
    });
  }

  /** Crea un elemento con atributos y chicos (texto siempre como textContent). */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ---------- Estado ----------

  var config = { baseUrl: '', configured: false, trackByDefault: true };
  var me = null; // { email, name, workspace, canWrite }
  var current = null; // mensaje abierto: { email, name, messageEl }
  var renderedKey = null;
  var collapsed = false;

  // ---------- Lectura del DOM de Gmail ----------

  function openMessageEl() {
    var msgs = document.querySelectorAll('div.adn[data-legacy-message-id], div.adn[data-message-id]');
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].querySelector('.a3s')) return msgs[i];
    }
    return msgs.length ? msgs[msgs.length - 1] : null;
  }

  function readMessage(msgEl) {
    var senderEl = msgEl.querySelector('span.gD[email]') || msgEl.querySelector('span[email]');
    if (!senderEl) return null;
    var from = (senderEl.getAttribute('email') || '').toLowerCase();
    var name = senderEl.getAttribute('name') || senderEl.textContent || '';
    var recipients = [];
    msgEl.querySelectorAll('span.g2[email]').forEach(function (r) {
      var e = (r.getAttribute('email') || '').toLowerCase();
      if (e && recipients.indexOf(e) < 0) recipients.push(e);
    });
    var subjectEl = document.querySelector('h2.hP');
    var bodyEl = msgEl.querySelector('.a3s');
    var dateEl = msgEl.querySelector('span.g3[title]');
    var rawId =
      msgEl.getAttribute('data-legacy-message-id') || (msgEl.getAttribute('data-message-id') || '').replace(/^#?msg-[a-z]:/, '');
    return {
      messageId: rawId,
      threadId: subjectEl ? subjectEl.getAttribute('data-legacy-thread-id') || '' : '',
      from: name && name !== from ? name + ' <' + from + '>' : from,
      fromEmail: from,
      fromName: name,
      to: recipients.join(', '),
      recipients: recipients,
      subject: subjectEl ? subjectEl.textContent.trim() : '',
      body: bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '',
      sentAt: dateEl ? dateEl.getAttribute('title') : null,
    };
  }

  /** A quién mostrar: el remitente o, si el remitente soy yo, el primer destinatario. */
  function focusPerson(msg) {
    var mine = me && me.email ? me.email.toLowerCase() : '';
    if (mine && msg.fromEmail === mine) {
      var other = msg.recipients.filter(function (e) {
        return e !== mine;
      })[0];
      if (other) {
        var chip = document.querySelector('span.g2[email="' + other.replace(/"/g, '') + '"]');
        return { email: other, name: chip ? chip.getAttribute('name') || '' : '' };
      }
    }
    return { email: msg.fromEmail, name: msg.fromName };
  }

  // ---------- Panel ----------

  var panel = el('aside', { id: 'zs-crm', class: 'zs-crm', role: 'complementary', 'aria-label': t('extName') });
  var toggle = el('button', {
    type: 'button',
    class: 'zs-toggle',
    'aria-expanded': 'true',
    'aria-controls': 'zs-crm-body',
    title: t('panelToggle'),
  });
  toggle.appendChild(el('span', { class: 'zs-mark', 'aria-hidden': 'true', text: '0' }));
  toggle.appendChild(el('span', { class: 'zs-sr', text: t('panelToggle') }));
  var content = el('div', { class: 'zs-content', 'aria-live': 'polite' });
  var body = el('div', { id: 'zs-crm-body', class: 'zs-body' }, [
    el('header', { class: 'zs-head' }, [
      el('span', { class: 'zs-mark', 'aria-hidden': 'true', text: '0' }),
      el('strong', { text: 'Zerosoft CRM' }),
      el('button', {
        type: 'button',
        class: 'zs-icon-btn',
        title: t('settings'),
        'aria-label': t('settings'),
        text: '⚙',
        onclick: function () {
          send({ type: 'openOptions' });
        },
      }),
    ]),
    content,
  ]);
  panel.appendChild(toggle);
  panel.appendChild(body);
  var toast = el('div', { class: 'zs-toast', role: 'status', 'aria-live': 'polite' });

  function setCollapsed(next) {
    collapsed = next;
    panel.classList.toggle('is-collapsed', next);
    toggle.setAttribute('aria-expanded', next ? 'false' : 'true');
    try {
      chrome.storage.local.set({ panelCollapsed: next });
    } catch (e) {
      /* sin storage: queda en memoria */
    }
  }
  toggle.addEventListener('click', function () {
    setCollapsed(!collapsed);
  });

  var toastTimer = null;
  function showToast(text, kind) {
    toast.textContent = text;
    toast.className = 'zs-toast is-visible' + (kind === 'error' ? ' is-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.className = 'zs-toast';
    }, 4000);
  }

  function errorText(code) {
    if (code === 'not_configured') return t('errNotConfigured');
    if (code === 'invalid_key') return t('errInvalidKey');
    if (code === 'insufficient_scope') return t('errScope');
    if (code === 'network_error') return t('errNetwork');
    if (code === 'rate_limited') return t('errRateLimited');
    if (code === 'extension_reloaded') return t('errReloaded');
    return t('errGeneric');
  }

  function render(nodes) {
    content.textContent = '';
    nodes.forEach(function (n) {
      if (n) content.appendChild(n);
    });
  }

  function section(title, children) {
    return el('section', { class: 'zs-section' }, [el('h3', { class: 'zs-h', text: title })].concat(children));
  }

  function renderNotConfigured() {
    render([
      el('p', { class: 'zs-muted', text: t('notConfigured') }),
      el('button', {
        type: 'button',
        class: 'zs-btn zs-btn-solid',
        text: t('openSettings'),
        onclick: function () {
          send({ type: 'openOptions' });
        },
      }),
    ]);
  }

  function renderError(code, retry) {
    render([
      el('p', { class: 'zs-error', role: 'alert', text: errorText(code) }),
      el('div', { class: 'zs-actions' }, [
        el('button', { type: 'button', class: 'zs-btn', text: t('retry'), onclick: retry }),
        code === 'invalid_key' || code === 'not_configured' || code === 'network_error'
          ? el('button', {
              type: 'button',
              class: 'zs-btn',
              text: t('openSettings'),
              onclick: function () {
                send({ type: 'openOptions' });
              },
            })
          : null,
      ]),
    ]);
  }

  function renderLoading() {
    render([el('p', { class: 'zs-muted zs-loading', text: t('loading') })]);
  }

  function renderEmpty() {
    render([el('p', { class: 'zs-muted', text: t('emptyNoEmail') })]);
  }

  function openApp(path) {
    return function (e) {
      if (e) e.preventDefault();
      send({ type: 'openApp', path: path });
    };
  }

  function appLink(text, path, cls) {
    return el('a', { href: Z.appUrl(config.baseUrl, path), class: cls || 'zs-link', text: text, onclick: openApp(path) });
  }

  // Resultado del último registro: sobrevive al refresco del panel que lo sigue.
  var logNotice = null;

  function logButton() {
    var status = el('p', { class: 'zs-muted zs-log-status' });
    if (logNotice && current && logNotice.email === current.email) status.textContent = logNotice.text;
    var btn = el('button', { type: 'button', class: 'zs-btn', text: t('logEmail') });
    btn.addEventListener('click', function () {
      var msgEl = openMessageEl();
      var msg = msgEl && readMessage(msgEl);
      if (!msg || !msg.messageId) {
        status.textContent = t('logNoMessage');
        return;
      }
      btn.disabled = true;
      status.textContent = t('logging');
      send({
        type: 'logEmail',
        email: {
          messageId: msg.messageId,
          threadId: msg.threadId || undefined,
          subject: msg.subject,
          body: msg.body,
          from: msg.from,
          to: msg.to,
          sentAt: msg.sentAt,
        },
      }).then(function (res) {
        btn.disabled = false;
        if (res.ok) {
          status.textContent = res.data && res.data.duplicate ? t('logAlready') : t('logDone');
          logNotice = current ? { email: current.email, text: status.textContent } : null;
          if (!(res.data && res.data.duplicate)) refresh(true);
        } else if (res.error === 'no_contact') {
          status.textContent = t('logNoContact');
        } else {
          status.textContent = errorText(res.error);
        }
      });
    });
    return el('div', { class: 'zs-log' }, [btn, status]);
  }

  function renderNotFound(person) {
    var split = Z.splitName(person.name && person.name.indexOf('@') < 0 ? person.name : '');
    var first = el('input', { type: 'text', id: 'zs-first', class: 'zs-input', value: split.firstName, autocomplete: 'off' });
    var last = el('input', { type: 'text', id: 'zs-last', class: 'zs-input', value: split.lastName, autocomplete: 'off' });
    var err = el('p', { class: 'zs-error', role: 'alert' });
    var submit = el('button', { type: 'submit', class: 'zs-btn zs-btn-solid', text: t('createContact') });
    var form = el('form', { class: 'zs-form' }, [
      el('label', { for: 'zs-first', class: 'zs-label', text: t('firstName') }),
      first,
      el('label', { for: 'zs-last', class: 'zs-label', text: t('lastName') }),
      last,
      el('div', { class: 'zs-actions' }, [submit]),
      err,
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit.disabled = true;
      err.textContent = '';
      send({
        type: 'createContact',
        email: person.email,
        firstName: first.value.trim(),
        lastName: last.value.trim(),
      }).then(function (res) {
        submit.disabled = false;
        if (!res.ok) {
          err.textContent = errorText(res.error);
          return;
        }
        showToast(t('contactCreated'));
        refresh(true);
      });
    });
    render([
      el('div', { class: 'zs-person' }, [
        el('p', { class: 'zs-name', text: person.name || person.email }),
        el('p', { class: 'zs-muted', text: person.email }),
      ]),
      el('p', { class: 'zs-note', text: t('notInCrm') }),
      form,
    ]);
  }

  function taskForm(contactId, onDone) {
    var subject = el('input', { type: 'text', id: 'zs-task-subject', class: 'zs-input', required: true, maxlength: '200' });
    var due = el('input', { type: 'date', id: 'zs-task-due', class: 'zs-input' });
    var err = el('p', { class: 'zs-error', role: 'alert' });
    var save = el('button', { type: 'submit', class: 'zs-btn zs-btn-solid', text: t('save') });
    var cancel = el('button', { type: 'button', class: 'zs-btn', text: t('cancel') });
    var form = el('form', { class: 'zs-form zs-task-form' }, [
      el('label', { for: 'zs-task-subject', class: 'zs-label', text: t('taskSubject') }),
      subject,
      el('label', { for: 'zs-task-due', class: 'zs-label', text: t('taskDue') }),
      due,
      el('div', { class: 'zs-actions' }, [save, cancel]),
      err,
    ]);
    cancel.addEventListener('click', function () {
      onDone(false);
    });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDone(false);
      }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var s = subject.value.trim();
      if (!s) {
        err.textContent = t('taskSubjectRequired');
        subject.focus();
        return;
      }
      save.disabled = true;
      send({ type: 'createTask', contactId: contactId, subject: s, dueAt: due.value || undefined }).then(function (res) {
        save.disabled = false;
        if (!res.ok) {
          err.textContent = errorText(res.error);
          return;
        }
        showToast(t('taskCreated'));
        onDone(true);
      });
    });
    setTimeout(function () {
      subject.focus({ preventScroll: true });
    }, 0);
    return form;
  }

  function renderContact(data) {
    var c = data.contact;
    var meta = [c.jobTitle, data.company ? data.company.name : ''].filter(Boolean).join(' · ');
    var deals = data.deals.length
      ? el(
          'ul',
          { class: 'zs-list' },
          data.deals.map(function (d) {
            return el('li', { class: 'zs-item' }, [
              appLink(d.name, d.url),
              el('span', { class: 'zs-muted', text: [d.stage, Z.formatAmount(d.amount, d.currency, locale)].filter(Boolean).join(' · ') }),
            ]);
          }),
        )
      : el('p', { class: 'zs-muted', text: t('noDeals') });

    var taskWrap = el('div');
    function drawTasks() {
      taskWrap.textContent = '';
      if (!data.tasks.length) taskWrap.appendChild(el('p', { class: 'zs-muted', text: t('noTasks') }));
      else
        taskWrap.appendChild(
          el(
            'ul',
            { class: 'zs-list' },
            data.tasks.map(function (task) {
              var due = Z.formatDue(task.dueAt, locale);
              var box = el('input', { type: 'checkbox', id: 'zs-task-' + task.id, 'aria-label': t('completeTask', [task.subject]) });
              box.addEventListener('change', function () {
                box.disabled = true;
                send({ type: 'completeTask', id: task.id }).then(function (res) {
                  if (!res.ok) {
                    box.checked = false;
                    box.disabled = false;
                    showToast(errorText(res.error), 'error');
                    return;
                  }
                  data.tasks = data.tasks.filter(function (x) {
                    return x.id !== task.id;
                  });
                  drawTasks();
                });
              });
              return el('li', { class: 'zs-item zs-task' }, [
                box,
                el('label', { for: 'zs-task-' + task.id, text: task.subject }),
                due.label ? el('span', { class: due.overdue ? 'zs-due is-overdue' : 'zs-due', text: due.label }) : null,
              ]);
            }),
          ),
        );
      var add = el('button', { type: 'button', class: 'zs-btn zs-btn-small', text: t('addTask') });
      add.addEventListener('click', function () {
        var form = taskForm(c.id, function (created) {
          if (created) refresh(true);
          else {
            form.remove();
            add.hidden = false;
            add.focus();
          }
        });
        add.hidden = true;
        taskWrap.appendChild(form);
      });
      taskWrap.appendChild(add);
    }
    drawTasks();

    render([
      el('div', { class: 'zs-person' }, [
        appLink(c.name, c.url, 'zs-name zs-link'),
        meta ? el('p', { class: 'zs-muted', text: meta }) : null,
        el('p', { class: 'zs-muted', text: c.email }),
        c.phone ? el('p', { class: 'zs-muted', text: c.phone }) : null,
      ]),
      logButton(),
      section(t('dealsTitle', [String(data.deals.length)]), [deals]),
      section(t('tasksTitle', [String(data.tasks.length)]), [taskWrap]),
      el('p', { class: 'zs-muted zs-foot' }, [
        data.emailsLogged ? t('emailsLogged', [String(data.emailsLogged)]) + ' · ' : '',
        appLink(t('openInCrm'), c.url),
      ]),
    ]);
  }

  var loadSeq = 0;
  function load(person) {
    var seq = ++loadSeq;
    renderLoading();
    send({ type: 'sidebar', email: person.email }).then(function (res) {
      if (seq !== loadSeq) return;
      if (!res.ok) {
        renderError(res.error, function () {
          refresh(true);
        });
        return;
      }
      if (res.data && res.data.contact) renderContact(res.data);
      else renderNotFound(person);
    });
  }

  function refresh(force) {
    if (!config.configured) {
      if (renderedKey !== 'not_configured') {
        renderedKey = 'not_configured';
        renderNotConfigured();
      }
      return;
    }
    var msgEl = openMessageEl();
    var msg = msgEl && readMessage(msgEl);
    if (!msg || !msg.fromEmail) {
      current = null;
      if (renderedKey !== 'empty') {
        renderedKey = 'empty';
        renderEmpty();
      }
      return;
    }
    var person = focusPerson(msg);
    current = person;
    if (!force && renderedKey === 'person:' + person.email) return;
    renderedKey = 'person:' + person.email;
    load(person);
  }

  // ---------- Redacción: "Registrar y trackear" ----------

  var SEND_SELECTOR = 'div[role="button"].aoO, div[role="button"][data-tooltip^="Send"], div[role="button"][data-tooltip^="Enviar"]';
  var replaying = false;

  function composeRoot(btn) {
    var node = btn.parentElement;
    while (node && node !== document.body) {
      if (node.querySelector('[contenteditable="true"]')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function composeBody(root) {
    return root.querySelector('div[contenteditable="true"][role="textbox"]') || root.querySelector('[contenteditable="true"]');
  }

  function composeData(root) {
    var to = [];
    var cc = [];
    function add(list, value) {
      Z.parseEmails(value).forEach(function (e) {
        if (to.indexOf(e) < 0 && cc.indexOf(e) < 0) list.push(e);
      });
    }
    root.querySelectorAll('input[name="to"], textarea[name="to"]').forEach(function (i) {
      add(to, i.value);
    });
    root.querySelectorAll('input[name="cc"], textarea[name="cc"], input[name="bcc"], textarea[name="bcc"]').forEach(function (i) {
      add(cc, i.value);
    });
    var bodyEl = composeBody(root);
    root.querySelectorAll('[data-hovercard-id], span[email]').forEach(function (chip) {
      if (bodyEl && bodyEl.contains(chip)) return;
      add(to, chip.getAttribute('data-hovercard-id') || chip.getAttribute('email') || '');
    });
    var subject = root.querySelector('input[name="subjectbox"]');
    var thread = document.querySelector('h2.hP');
    return {
      to: to.join(', '),
      cc: cc.join(', '),
      subject: subject ? subject.value : thread ? thread.textContent.trim() : '',
      body: bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '',
      threadId: subject ? '' : (thread && thread.getAttribute('data-legacy-thread-id')) || '',
    };
  }

  function replay(btn) {
    replaying = true;
    try {
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    } finally {
      replaying = false;
    }
  }

  function trackAndSend(btn) {
    btn.setAttribute('data-zs-state', 'pending');
    var root = composeRoot(btn);
    var data = root ? composeData(root) : null;
    if (!data || (!data.to && !data.cc)) {
      // Sin destinatarios: que Gmail muestre su propio aviso.
      btn.setAttribute('data-zs-state', '');
      replayOnce(btn);
      return;
    }
    send({
      type: 'track',
      email: {
        to: data.to || data.cc,
        cc: data.to ? data.cc || undefined : undefined,
        subject: data.subject,
        body: data.body,
        threadId: data.threadId || undefined,
      },
    }).then(function (res) {
      var bodyEl = composeBody(root);
      if (res.ok && res.data && res.data.pixelUrl && bodyEl) {
        bodyEl.insertAdjacentHTML('beforeend', Z.pixelHtml(res.data.pixelUrl));
        showToast(t('trackDone'));
        if (current && data.to.indexOf(current.email) >= 0) refresh(true);
      } else {
        showToast(t('trackFailed'), 'error');
      }
      btn.setAttribute('data-zs-state', 'done');
      replay(btn);
    });
  }

  function replayOnce(btn) {
    btn.setAttribute('data-zs-state', 'done');
    replay(btn);
    btn.setAttribute('data-zs-state', '');
  }

  function trackEnabled(btn) {
    var box = btn.__zsTrackBox;
    return Boolean(box && box.checked);
  }

  function onSendPointer(e) {
    if (replaying) return;
    var target = e.target;
    var btn = target && target.closest ? target.closest('[data-zs-send="1"]') : null;
    if (!btn || !trackEnabled(btn)) return;
    var state = btn.getAttribute('data-zs-state') || '';
    if (state === 'done') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (state !== 'pending' && (e.type === 'mousedown' || e.type === 'click')) trackAndSend(btn);
  }

  function onComposeKey(e) {
    if (replaying || e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var buttons = document.querySelectorAll('[data-zs-send="1"]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var root = composeRoot(btn);
      if (!root || !root.contains(target) || !trackEnabled(btn)) continue;
      var state = btn.getAttribute('data-zs-state') || '';
      if (state === 'done') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (state !== 'pending') trackAndSend(btn);
      return;
    }
  }

  /** Selector de templates del CRM en la redacción: inserta el texto con las variables del destinatario. */
  function templatePicker(btn) {
    var select = el('select', { class: 'zs-template', 'aria-label': t('templateLabel'), title: t('templateLabel') }, [
      el('option', { value: '', text: t('templateLabel') }),
    ]);
    select.disabled = !config.configured;
    var loaded = false;
    function load() {
      if (loaded || select.disabled) return;
      loaded = true;
      send({ type: 'templates' }).then(function (res) {
        if (!res.ok || !res.data) {
          loaded = false;
          showToast(errorText(res.error), 'error');
          return;
        }
        var list = res.data.templates || [];
        if (!list.length) select.appendChild(el('option', { value: '', text: t('templateNone'), disabled: true }));
        list.forEach(function (tp) {
          select.appendChild(el('option', { value: tp.id, text: tp.name }));
        });
      });
    }
    select.addEventListener('focus', load);
    select.addEventListener('mousedown', load);
    select.addEventListener('change', function () {
      var templateId = select.value;
      if (!templateId) return;
      var root = composeRoot(btn);
      var data = root ? composeData(root) : null;
      send({ type: 'renderTemplate', templateId: templateId, to: data ? data.to || data.cc : '' }).then(function (res) {
        select.value = '';
        if (!res.ok || !res.data) {
          showToast(errorText(res.error), 'error');
          return;
        }
        var bodyEl = root ? composeBody(root) : null;
        if (bodyEl) {
          bodyEl.focus();
          bodyEl.insertAdjacentHTML('afterbegin', Z.textToHtml(res.data.body));
          bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        var subject = root ? root.querySelector('input[name="subjectbox"]') : null;
        if (subject && !subject.value && res.data.subject) {
          subject.value = res.data.subject;
          subject.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast(res.data.missing && res.data.missing.length ? t('templateMissing') : t('templateInserted'));
      });
    });
    return select;
  }

  function decorateComposes() {
    document.querySelectorAll(SEND_SELECTOR).forEach(function (btn) {
      if (btn.getAttribute('data-zs-send') === '1') return;
      btn.setAttribute('data-zs-send', '1');
      var id = 'zs-track-' + Math.random().toString(36).slice(2, 9);
      var box = el('input', { type: 'checkbox', id: id, class: 'zs-track-box' });
      box.checked = config.configured && config.trackByDefault;
      box.disabled = !config.configured;
      btn.__zsTrackBox = box;
      var label = el('label', { class: 'zs-track', for: id, title: config.configured ? t('trackHint') : t('notConfigured') }, [
        box,
        el('span', { text: t('trackLabel') }),
      ]);
      var picker = templatePicker(btn);
      btn.__zsTemplate = picker;
      var host = btn.parentElement;
      if (host) {
        host.insertBefore(label, btn.nextSibling);
        host.insertBefore(picker, label.nextSibling);
      }
    });
  }

  // ---------- Arranque ----------

  var scheduled = null;
  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(function () {
      scheduled = null;
      decorateComposes();
      refresh(false);
    }, 300);
  }

  function boot() {
    document.body.appendChild(panel);
    document.body.appendChild(toast);
    document.addEventListener('mousedown', onSendPointer, true);
    document.addEventListener('mouseup', onSendPointer, true);
    document.addEventListener('click', onSendPointer, true);
    document.addEventListener('keydown', onComposeKey, true);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', schedule);
    try {
      chrome.storage.local.get(['panelCollapsed']).then(function (s) {
        if (s.panelCollapsed) setCollapsed(true);
      });
      chrome.storage.onChanged.addListener(function (changes) {
        if (changes.baseUrl || changes.token || changes.trackByDefault) init();
      });
    } catch (e) {
      /* sin storage */
    }
    init();
  }

  function init() {
    send({ type: 'config' }).then(function (res) {
      config = res.ok && res.data ? res.data : { baseUrl: '', configured: false, trackByDefault: true };
      renderedKey = null;
      if (!config.configured) {
        me = null;
        refresh(true);
        return;
      }
      send({ type: 'me' }).then(function (who) {
        me = who.ok ? who.data : null;
        if (!who.ok) {
          renderedKey = 'error';
          renderError(who.error, init);
          return;
        }
        document.querySelectorAll('[data-zs-send="1"]').forEach(function (btn) {
          if (btn.__zsTrackBox) {
            btn.__zsTrackBox.disabled = false;
            btn.__zsTrackBox.checked = config.trackByDefault;
          }
          if (btn.__zsTemplate) btn.__zsTemplate.disabled = false;
        });
        decorateComposes();
        refresh(true);
      });
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
