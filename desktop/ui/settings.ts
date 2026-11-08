/**
 * Ajustes y bienvenida del escritorio: pestañas Primeros pasos, General,
 * Voice, Diccionario, Historial y Cuenta. Cada cambio se guarda al momento
 * (como las preferencias de macOS). Esc cierra; las flechas mueven entre
 * pestañas.
 */
import {
  api,
  formatClock,
  type DictionaryEntryView,
  type PendingMeta,
  type PermissionAsk,
  type SettingsInput,
  type SettingsView,
  type VoiceServerSettings,
} from './api';

type Tab = 'start' | 'general' | 'voice' | 'dictionary' | 'history' | 'account';
const TABS: Tab[] = ['start', 'general', 'voice', 'dictionary', 'history', 'account'];

const nav = document.getElementById('tabs')!;
const main = document.getElementById('main')!;
let view: SettingsView | null = null;
let tab: Tab = 'start';
let poll = 0;

// ---------- DOM ----------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const s = (key: string, vars: Record<string, string | number> = {}) =>
  (view?.strings[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

function kbd(accel: string) {
  return h('kbd', {}, accel.replace(/CommandOrControl/g, view?.platform === 'darwin' ? 'Command' : 'Ctrl').replace(/\+/g, ' + '));
}

/** Texto con {key} reemplazado por un <kbd>. */
function withKey(text: string, accel: string): Array<Node | string> {
  const [a, b] = text.split('{key}');
  return b === undefined ? [text] : [a, kbd(accel), b];
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function status(): HTMLSpanElement {
  return h('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
}

function flash(el: HTMLElement, text: string, kind: '' | 'ok' | 'error' = 'ok') {
  el.className = `status ${kind}`;
  el.textContent = text;
  if (kind !== 'error') window.setTimeout(() => (el.textContent === text ? (el.textContent = '') : null), 1800);
}

function remoteFailure(err: string, retry: () => void): HTMLElement {
  if (err === 'signed_out') return h('div', { class: 'notice' }, s('needSignIn'), ' ', h('button', { class: 'btn', type: 'button', onclick: () => void api.signIn() }, s('signIn')));
  return h('div', { class: 'notice error' }, s('errLoad'), ' ', h('button', { class: 'btn', type: 'button', onclick: retry }, s('retryLoad')));
}

function timeAgo(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString(view?.locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(view?.locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- Pestañas ----------

function tabLabel(t: Tab) {
  return s(`tab${t[0].toUpperCase()}${t.slice(1)}`);
}

function renderNav() {
  nav.textContent = '';
  for (const t of TABS) {
    const pending = t === 'history' && view?.pending.length ? h('span', { class: 'count', 'aria-hidden': 'true' }, String(view.pending.length)) : null;
    nav.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `tab-${t}`,
          'aria-selected': String(t === tab),
          'aria-controls': 'main',
          tabindex: t === tab ? '0' : '-1',
          onclick: () => go(t),
        },
        tabLabel(t),
        pending,
      ),
    );
  }
}

nav.addEventListener('keydown', (e) => {
  const i = TABS.indexOf(tab);
  let next: Tab | null = null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
  else if (e.key === 'Home') next = TABS[0];
  else if (e.key === 'End') next = TABS[TABS.length - 1];
  if (!next) return;
  e.preventDefault();
  go(next);
  document.getElementById(`tab-${next}`)?.focus();
});

function go(t: Tab) {
  tab = t;
  window.clearInterval(poll);
  renderNav();
  main.setAttribute('role', 'tabpanel');
  main.setAttribute('aria-labelledby', `tab-${t}`);
  main.textContent = '';
  main.scrollTop = 0;
  const panel = h('div', { class: 'panel', 'data-panel': t });
  main.append(panel);
  if (t === 'start') renderStart(panel);
  else if (t === 'general') renderGeneral(panel);
  else if (t === 'voice') void renderVoice(panel);
  else if (t === 'dictionary') void renderDictionary(panel);
  else if (t === 'history') void renderHistory(panel);
  else renderAccount(panel);
}

// ---------- Primeros pasos ----------

function renderStart(panel: HTMLElement) {
  const v = view!;
  const mac = v.platform === 'darwin';
  const holdKey = v.shortcuts.find((x) => x.id === v.shortcut)?.label ?? v.shortcut;
  const steps = h('ol', { class: 'steps' });
  let n = 0;
  const step = (done: boolean, title: string, help: Child, actions: Child[], body?: Child) => {
    n += 1;
    steps.append(
      h(
        'li',
        { class: `step${done ? ' done' : ''}` },
        h('span', { class: 'num', 'aria-hidden': 'true' }, done ? '✓' : String(n)),
        h('div', {}, h('span', { class: 'step-title' }, title), h('span', { class: `step-state ${done ? 'ok' : 'no'}` }, done ? s('granted') : '')),
        h('div', { class: 'actions' }, ...(done ? [] : actions)),
        help ? h('div', { class: 'step-help' }, help) : null,
        body ? h('div', { class: 'step-body' }, body) : null,
      ),
    );
  };
  const acct = v.account;
  step(
    acct.signedIn,
    s('stepSignIn'),
    acct.signedIn ? s('signedInAs', { who: acct.email }) : acct.offline ? s('offlineAccount') : s('stepSignInHelp'),
    [h('button', { class: 'btn primary', type: 'button', onclick: () => void api.signIn() }, s('signIn'))],
  );
  const mic = v.permissions.microphone;
  if (mic !== 'not-needed') {
    step(mic === 'granted', s('stepMic'), s('permMicHelp'), [
      h('button', { class: 'btn', type: 'button', onclick: () => void ask('microphone') }, mic === 'not-determined' ? s('allow') : s('openSystemSettings')),
    ]);
  }
  const acc = v.permissions.accessibility;
  if (mac && acc !== 'not-needed') {
    // La llave prendida en Ajustes del Sistema puede ser de otra build (firma ad hoc): se explica
    // y "Restablecer permiso" borra esa entrada y la pide de nuevo para esta build.
    const stale = v.accessibilityHint === 'updated' || v.accessibilityHint === 'adhoc';
    const help = h(
      'span',
      {},
      s('stepAccessibilityHelp'),
      stale ? h('span', { class: 'step-note', id: 'acc-hint' }, s(v.accessibilityHint === 'updated' ? 'accessibilityUpdated' : 'accessibilityAdhoc')) : null,
      v.signature === 'adhoc' ? h('span', { class: 'step-note muted' }, s('accessibilityAdhocUpdates')) : null,
    );
    const buttons = [
      h('button', { class: 'btn', type: 'button', onclick: () => void ask('accessibility') }, s('openSystemSettings')),
      stale ? h('button', { class: 'btn', type: 'button', id: 'acc-reset', onclick: () => void ask('accessibility-reset') }, s('accessibilityReset')) : null,
      h('button', { class: 'btn link', type: 'button', onclick: () => void reload(false) }, s('checkAgain')),
    ];
    // Con tres botones van abajo, en su fila: al lado del título lo aplastan.
    const granted = acc === 'granted';
    step(granted, s('stepAccessibility'), help, stale ? [] : buttons, stale && !granted ? h('div', { class: 'row step-row' }, ...buttons) : undefined);
  }
  const tryBox = h('textarea', { id: 'try', 'aria-label': s('stepTry'), placeholder: s('tryPlaceholder'), rows: 3 });
  step(
    false,
    s('stepTry'),
    h(
      'span',
      {},
      ...(v.mode !== 'toggle' ? withKey(s('stepTryHelp'), holdKey) : []),
      ' ',
      ...(v.mode !== 'hold' ? withKey(s('stepTryToggle'), holdKey) : []),
    ),
    [],
    tryBox,
  );
  const blocks: HTMLElement[] = [];
  if (mac && acc !== 'granted') blocks.push(h('p', { class: 'notice' }, s('pasteNeedsAccessibility')));
  if (v.shortcutTaken) blocks.push(h('p', { class: 'notice error' }, s('shortcutTaken')));
  panel.append(
    h('h1', {}, s('startTitle')),
    h('p', { class: 'lead' }, s('startIntro')),
    // La primera vez la ventana se abre sola: se dice por qué y dónde volver a encontrarla.
    ...(v.onboarded ? [] : [h('p', { class: 'notice info', id: 'first-run' }, s('firstRunNotice', { where: s(mac ? 'settingsWhereMac' : 'settingsWhereWin') }))]),
    steps,
    ...blocks,
    h(
      'div',
      { class: 'row', style: 'margin-top:20px' },
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            await api.save({ onboarded: true });
            window.close();
          },
        },
        s('finish'),
      ),
    ),
  );
  // Mientras falte algo, el estado se relee solo (Accesibilidad no devuelve el foco a la ventana).
  const missing = !acct.signedIn || (mic !== 'granted' && mic !== 'not-needed') || (mac && acc !== 'granted');
  if (missing) poll = window.setInterval(() => void reload(false), 1500);
}

async function ask(kind: PermissionAsk) {
  const next = await api.ask(kind);
  if (next) {
    view = next;
    if (tab === 'start') go('start');
  }
}

// ---------- General ----------

function renderGeneral(panel: HTMLElement) {
  const v = view!;
  const st = status();
  const save = async (input: SettingsInput) => {
    const res = await api.save(input);
    if (!res.ok || !res.view) return flash(st, s('saveFailed'), 'error');
    view = res.view;
    flash(st, s('saved'));
    if (view.shortcutTaken) go('general');
  };
  const modes = (['both', 'hold', 'toggle'] as const).map((m) =>
    h(
      'label',
      { class: 'radio' },
      h('input', { type: 'radio', name: 'mode', value: m, checked: v.mode === m, onchange: () => void save({ mode: m }).then(() => go('general')) }),
      h('span', {}, s(`mode${m[0].toUpperCase()}${m.slice(1)}`)),
    ),
  );
  const shortcut = h('select', { id: 'shortcut', onchange: (e: Event) => void save({ shortcut: (e.target as HTMLSelectElement).value }) });
  for (const k of v.shortcuts) shortcut.append(h('option', { value: k.id, selected: k.id === v.shortcut }, k.label));
  const check = (id: string, checked: boolean, text: string, key: keyof SettingsInput) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked, onchange: (e: Event) => void save({ [key]: (e.target as HTMLInputElement).checked }) }), h('span', {}, text));
  panel.append(
    h('div', { class: 'row' }, h('h1', {}, s('tabGeneral')), h('span', { class: 'spacer' }), st),
    h('p', { class: 'lead' }, s('holdHelp')),
    h('section', {}, h('h2', {}, s('mode')), ...modes),
    h(
      'section',
      {},
      h('h2', {}, s('dictation')),
      h('div', { class: 'grid2' }, h('div', {}, h('label', { class: 'field', for: 'shortcut' }, s('holdKey')), shortcut)),
      v.shortcutTaken ? h('p', { class: 'notice error' }, s('shortcutTaken')) : null,
      h('p', { class: 'help' }, s('handsFreeHelp')),
      h('p', { class: 'help' }, s('pasteLastHint'), ': ', kbd(v.pasteLastShortcut)),
      check('restore', v.restoreClipboard, s('restoreClipboard'), 'restoreClipboard'),
    ),
    h(
      'section',
      {},
      h('h2', {}, s('meetings')),
      check('indicator', v.recordingIndicator, s('recordingIndicator'), 'recordingIndicator'),
      h('p', { class: 'help check-help' }, s('recordingIndicatorHelp')),
    ),
    h('section', {}, h('h2', {}, s('general')), check('login', v.openAtLogin, s('openAtLogin'), 'openAtLogin')),
    h('section', {}, h('h2', {}, s('settingsWhereTitle')), h('p', { class: 'help', style: 'margin:0' }, capitalize(s(v.platform === 'darwin' ? 'settingsWhereMac' : 'settingsWhereWin')), '.')),
  );
}

// ---------- Voice (servidor) ----------

async function renderVoice(panel: HTMLElement) {
  const st = status();
  panel.append(h('div', { class: 'row' }, h('h1', {}, s('tabVoice')), h('span', { class: 'spacer' }), st), h('p', { class: 'lead' }, s('voiceIntro')));
  const body = h('div', { class: 'loading' }, s('loading'));
  panel.append(body);
  const res = await api.voiceGet();
  if (tab !== 'voice') return;
  body.className = '';
  body.textContent = '';
  if (!res.ok) return body.append(remoteFailure(res.error, () => go('voice')));
  let cur = res.settings;
  const save = async (patch: Partial<VoiceServerSettings>) => {
    const r = await api.voiceSave(patch);
    if (!r.ok) return flash(st, r.error === 'signed_out' ? s('needSignIn') : s('saveFailed'), 'error');
    cur = r.settings;
    flash(st, s('saved'));
    sync();
  };
  const langs = ['auto', 'en', 'es', 'pt'];
  if (!langs.includes(cur.language)) langs.push(cur.language);
  const names: Record<string, string> = { auto: s('langAuto'), en: 'English', es: 'Español', pt: 'Português' };
  const lang = h('select', { id: 'language', onchange: (e: Event) => void save({ language: (e.target as HTMLSelectElement).value }) });
  for (const l of langs) lang.append(h('option', { value: l, selected: l === cur.language }, names[l] ?? l));
  const modes: Array<[VoiceServerSettings['cleanupMode'], string]> = [
    ['raw', 'cleanupRaw'],
    ['clean', 'cleanupClean'],
    ['formal', 'cleanupFormal'],
    ['per_app', 'cleanupPerApp'],
  ];
  const mode = h('select', { id: 'cleanup', onchange: (e: Event) => void save({ cleanupMode: (e.target as HTMLSelectElement).value as VoiceServerSettings['cleanupMode'] }) });
  for (const [m, k] of modes) mode.append(h('option', { value: m, selected: m === cur.cleanupMode }, s(k)));
  const ai = h('input', { type: 'checkbox', id: 'ai', checked: cur.aiCleanup, onchange: (e: Event) => void save({ aiCleanup: (e.target as HTMLInputElement).checked }) });
  const ctxs: Array<[keyof VoiceServerSettings['styles'], string]> = [
    ['email', 'ctxEmail'],
    ['chat', 'ctxChat'],
    ['note', 'ctxNote'],
    ['other', 'ctxOther'],
  ];
  const styleSelects = ctxs.map(([c, k]) => {
    const sel = h('select', { id: `style-${c}`, onchange: (e: Event) => void save({ styles: { ...cur.styles, [c]: (e.target as HTMLSelectElement).value } as VoiceServerSettings['styles'] }) });
    for (const tone of ['formal', 'neutral', 'casual'] as const) sel.append(h('option', { value: tone, selected: cur.styles[c] === tone }, s(`tone${tone[0].toUpperCase()}${tone.slice(1)}`)));
    return h('div', {}, h('label', { class: 'field', for: `style-${c}` }, s(k)), sel);
  });
  const sync = () => {
    ai.disabled = cur.cleanupMode === 'raw';
    styleSelects.forEach((d) => ((d.querySelector('select') as HTMLSelectElement).disabled = cur.cleanupMode !== 'per_app'));
  };
  sync();
  body.append(
    h(
      'section',
      {},
      h(
        'div',
        { class: 'grid2' },
        h('div', {}, h('label', { class: 'field', for: 'language' }, s('language')), lang),
        h('div', {}, h('label', { class: 'field', for: 'cleanup' }, s('cleanupMode')), mode),
      ),
      h('p', { class: 'help' }, s('cleanupHelp')),
      h('label', { class: 'check' }, ai, h('span', {}, s('aiCleanup'))),
    ),
    h('section', {}, h('h2', {}, s('stylesTitle')), h('div', { class: 'grid2' }, ...styleSelects), h('p', { class: 'help' }, s('stylesHelp'))),
    h('p', {}, h('button', { class: 'btn link', type: 'button', onclick: () => void api.openVoice('settings') }, `${s('openInVoice')} ↗`)),
  );
}

// ---------- Diccionario ----------

async function renderDictionary(panel: HTMLElement) {
  const st = status();
  panel.append(h('div', { class: 'row' }, h('h1', {}, s('tabDictionary')), h('span', { class: 'spacer' }), st), h('p', { class: 'lead' }, s('dictIntro')));
  const body = h('div', { class: 'loading' }, s('loading'));
  panel.append(body);
  const res = await api.dictionaryList();
  if (tab !== 'dictionary') return;
  body.className = '';
  body.textContent = '';
  if (!res.ok) return body.append(remoteFailure(res.error, () => go('dictionary')));
  const kind = h('select', { id: 'dict-kind' }, h('option', { value: 'word' }, s('dictWord')), h('option', { value: 'replace' }, s('dictReplace')));
  const phrase = h('input', { type: 'text', id: 'dict-phrase', maxLength: 100, autocomplete: 'off', spellcheck: 'false' });
  const repl = h('input', { type: 'text', id: 'dict-repl', maxLength: 2000, autocomplete: 'off', spellcheck: 'false' });
  const phraseLabel = h('label', { class: 'field', for: 'dict-phrase' }, s('dictPhrase'));
  const form = h(
    'form',
    { class: 'add', 'data-kind': 'word' },
    h('div', {}, h('label', { class: 'field', for: 'dict-kind' }, s('dictKind')), kind),
    h('div', {}, phraseLabel, phrase),
    h('div', { class: 'only-replace' }, h('label', { class: 'field', for: 'dict-repl' }, s('dictWrite')), repl),
    h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, s('add'))),
  );
  kind.addEventListener('change', () => {
    form.dataset.kind = kind.value;
    phraseLabel.textContent = kind.value === 'replace' ? s('dictHeard') : s('dictPhrase');
  });
  const list = h('ul', { class: 'list' });
  const empty = h('p', { class: 'empty' }, s('dictEmpty'));
  let entries = res.entries;
  const paint = () => {
    list.textContent = '';
    list.hidden = !entries.length;
    empty.hidden = !!entries.length;
    for (const e of entries) {
      list.append(
        h(
          'li',
          {},
          h('div', { class: 'item-text' }, e.phrase, e.kind !== 'word' ? h('span', { class: 'arrow' }, '→') : null, e.kind !== 'word' ? e.replacement : null, e.shared ? h('span', { class: 'tag' }, s('team')) : null),
          h('div', { class: 'item-meta' }, e.kind === 'word' ? s('dictWord') : s('dictReplace')),
          h(
            'div',
            { class: 'item-actions' },
            h(
              'button',
              {
                class: 'btn link',
                type: 'button',
                'aria-label': `${s('remove')}: ${e.phrase}`,
                onclick: async () => {
                  const r = await api.dictionaryDelete(e.id);
                  if (!r.ok) return flash(st, s('saveFailed'), 'error');
                  entries = entries.filter((x) => x.id !== e.id);
                  paint();
                  flash(st, s('saved'));
                },
              },
              s('remove'),
            ),
          ),
        ),
      );
    }
  };
  let busy = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = phrase.value.trim();
    if (!p || (kind.value === 'replace' && !repl.value.trim()) || busy) return;
    busy = true;
    const r = await api.dictionaryAdd({ kind: kind.value, phrase: p, replacement: repl.value });
    busy = false;
    if (!r.ok) return flash(st, r.error === 'signed_out' ? s('needSignIn') : s('saveFailed'), 'error');
    entries = [{ id: r.id, kind: kind.value as DictionaryEntryView['kind'], phrase: p, replacement: kind.value === 'replace' ? repl.value : '', shared: false }, ...entries];
    phrase.value = '';
    repl.value = '';
    phrase.focus();
    paint();
    flash(st, s('saved'));
  });
  paint();
  body.append(form, list, empty);
}

// ---------- Historial ----------

function failureText(f: PendingMeta['failure']): string {
  const map: Record<string, string> = { offline: 'errOffline', signed_out: 'errSignedOut', rate_limited: 'errRateLimited', server: 'errServer' };
  return s(map[f] ?? 'errFailed');
}

async function renderHistory(panel: HTMLElement) {
  const v = view!;
  const st = status();
  const holdKey = v.shortcuts.find((x) => x.id === v.shortcut)?.label ?? v.shortcut;
  panel.append(h('div', { class: 'row' }, h('h1', {}, s('tabHistory')), h('span', { class: 'spacer' }), st), h('p', { class: 'lead' }, s('histIntro')));
  const lat = v.lastLatency;
  if (lat) {
    const sec = (ms: number | null) => (ms === null ? '?' : (ms / 1000).toFixed(1));
    const detail =
      lat.serverMs !== null
        ? s('lastLatencyDetail', { server: sec(lat.serverMs), tr: sec(lat.transcribeMs), cl: sec(lat.cleanupMs), net: sec(Math.max(0, lat.requestMs - lat.serverMs)), paste: sec(lat.pasteMs) })
        : '';
    panel.append(
      h(
        'p',
        { class: 'help', id: 'latency' },
        s('lastLatency', { s: sec(lat.totalMs) }),
        detail ? h('br') : null,
        detail,
        !lat.ai && lat.cleanupMs === 0 ? ` ${s('lastLatencyRules')}` : '',
      ),
    );
  }
  if (v.pending.length) {
    const plist = h('ul', { class: 'list', id: 'pending' });
    for (const m of v.pending) {
      plist.append(
        h(
          'li',
          {},
          h('div', {}, failureText(m.failure), m.attempts ? ` (${m.attempts})` : ''),
          h('div', { class: 'item-meta' }, [timeAgo(m.createdAt), formatClock(m.durationMs), m.sourceApp].filter(Boolean).join(' · ')),
          h(
            'div',
            { class: 'item-actions' },
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async (e: Event) => {
                  (e.currentTarget as HTMLButtonElement).disabled = true;
                  const r = await api.pendingRetry(m.id);
                  if (r?.view) view = r.view;
                  go('history');
                },
              },
              s('retry'),
            ),
            h(
              'button',
              {
                class: 'btn link',
                type: 'button',
                onclick: async () => {
                  const next = await api.pendingDiscard(m.id);
                  if (next) view = next;
                  go('history');
                },
              },
              s('discard'),
            ),
          ),
        ),
      );
    }
    panel.append(h('section', {}, h('h2', {}, s('pendingTitle')), h('p', { class: 'help', style: 'margin:0 0 10px' }, s('pendingHelp')), plist));
  }
  const body = h('div', { class: 'loading' }, s('loading'));
  panel.append(body);
  const res = await api.historyList();
  if (tab !== 'history') return;
  body.className = '';
  body.textContent = '';
  if (!res.ok) return body.append(remoteFailure(res.error, () => go('history')));
  if (!res.items.length) {
    body.append(h('p', { class: 'empty' }, ...withKey(s('histEmpty'), holdKey)));
    return;
  }
  const list = h('ul', { class: 'list', id: 'history' });
  for (const it of res.items) {
    const meta = [timeAgo(it.startedAt), it.durationMs ? formatClock(it.durationMs) : '', it.sourceApp && it.sourceApp !== 'desktop' ? it.sourceApp : '', it.capture === 'desktop' ? s('fromDesktop') : '']
      .filter(Boolean)
      .join(' · ');
    list.append(
      h(
        'li',
        {},
        h('div', { class: 'item-text' }, it.text),
        h('div', { class: 'item-meta' }, meta),
        h(
          'div',
          { class: 'item-actions' },
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                if (await api.historyCopy(it.text)) flash(st, s('copiedShort'));
              },
            },
            s('copy'),
          ),
          h('button', { class: 'btn', type: 'button', title: s('pasteHelp'), onclick: () => void api.historyPaste(it.text) }, s('pasteBack')),
        ),
      ),
    );
  }
  body.append(list, h('p', { class: 'help' }, s('pasteHelp')), h('p', {}, h('button', { class: 'btn link', type: 'button', onclick: () => void api.openVoice('history') }, `${s('openInVoice')} ↗`)));
}

// ---------- Cuenta ----------

function renderAccount(panel: HTMLElement) {
  const v = view!;
  const st = status();
  const acct = v.account;
  const server = h('input', { type: 'text', id: 'server', value: v.server, autocomplete: 'url', spellcheck: 'false' });
  const form = h(
    'form',
    { class: 'row' },
    h('label', { class: 'sr-only', for: 'server' }, s('server')),
    h('div', { style: 'flex:1;min-width:180px' }, server),
    h('button', { class: 'btn', type: 'submit' }, s('save')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api.save({ server: server.value });
    if (!res.ok) {
      flash(st, res.error === 'server' ? s('serverInvalid') : s('saveFailed'), 'error');
      server.focus();
      return;
    }
    if (res.view) view = res.view;
    flash(st, s('saved'));
  });
  // La sesión puede haber cambiado (login en el navegador, cierre en la web): se relee al abrir la pestaña.
  void api.get().then((next) => {
    if (!next || tab !== 'account') return;
    const changed = JSON.stringify(next.account) !== JSON.stringify(view?.account);
    view = next;
    if (changed) go('account');
  });
  const updates = v.updates === 'auto' ? s('updatesAuto') : v.updates === 'off' ? s('updatesOff') : s('updatesDev');
  panel.append(
    h('div', { class: 'row' }, h('h1', {}, s('tabAccount')), h('span', { class: 'spacer' }), st),
    h(
      'section',
      {},
      h('h2', {}, s('account')),
      h(
        'div',
        { class: 'row' },
        h('span', { id: 'account-state' }, acct.signedIn ? s('signedInAs', { who: acct.name ? `${acct.name} (${acct.email})` : acct.email }) : acct.offline ? s('offlineAccount') : s('notSignedIn')),
        h('span', { class: 'spacer' }),
        acct.signedIn
          ? h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  const next = await api.signOut();
                  if (next) view = next;
                  go('account');
                },
              },
              s('signOut'),
            )
          : h('button', { class: 'btn primary', type: 'button', onclick: () => void api.signIn() }, s('signIn')),
      ),
    ),
    h('section', {}, h('h2', {}, s('server')), form, h('p', { class: 'help' }, s('serverHelp'))),
    h(
      'section',
      {},
      h('h2', {}, s('updates')),
      h('p', { style: 'margin:0' }, s('version', { v: v.version })),
      h('p', { class: 'help' }, updates),
      v.updates === 'off' ? h('p', {}, h('button', { class: 'btn', type: 'button', onclick: () => void api.openVoice('download') }, s('downloadPage'))) : null,
    ),
  );
}

// ---------- Carga ----------

async function reload(rerender = true) {
  const v = await api.get();
  if (!v) return;
  const before = view ? JSON.stringify([view.permissions, view.account, view.shortcutTaken, view.pending.length]) : '';
  view = v;
  document.documentElement.lang = v.locale;
  document.title = v.strings.settingsTitle;
  // Solo se redibuja si cambió algo visible (no pisar lo que se está escribiendo).
  const after = JSON.stringify([v.permissions, v.account, v.shortcutTaken, v.pending.length]);
  if (rerender || (before !== after && (tab === 'start' || tab === 'account'))) go(tab);
  else renderNav();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

api.onRefresh(() => void reload(false));
api.onTab((t) => {
  if ((TABS as string[]).includes(t)) go(t as Tab);
});

const fromHash = location.hash.slice(1);
if ((TABS as string[]).includes(fromHash)) tab = fromHash as Tab;
void api.get().then((v) => {
  if (!v) return;
  view = v;
  document.documentElement.lang = v.locale;
  document.title = v.strings.settingsTitle;
  if (!fromHash) tab = v.onboarded ? 'general' : 'start';
  go(tab);
});
