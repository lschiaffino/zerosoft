/**
 * Ventana de Ajustes del escritorio: todos los ajustes en un lugar. A la izquierda, una caja de
 * búsqueda y la lista: "Este dispositivo" (secciones nativas de la app y Sin conexión) y los
 * grupos del servidor (Cuenta, Workspace, Productos: /api/settings/nav, la misma lista que
 * /app/settings, lib/settings-nav.ts). Las secciones nativas se pintan acá; una sección web se
 * carga en esta misma ventana (settings_open_web) con la sesión de la app, y su nav vuelve acá.
 * Cada cambio se guarda al momento. Esc limpia la búsqueda o cierra; flechas recorren la lista.
 */
import {
  api,
  formatClock,
  type DictionaryEntryView,
  type NavGroup,
  type PendingMeta,
  type PermissionAsk,
  type PermissionKind,
  type PermissionStatus,
  type SettingsInput,
  type SettingsView,
  type VoiceServerSettings,
} from './api';
import { renderPrivacy } from './settings-privacy';
import { tabsSection } from './settings-tabs';

/** Secciones nativas: las mismas que DESKTOP_NATIVE_SECTIONS en lib/settings-nav.ts (un test las compara). */
const TABS = ['start', 'general', 'meetings', 'voice', 'dictionary', 'history', 'permissions', 'privacy', 'updates', 'account'] as const;
type Tab = (typeof TABS)[number];

const NAV_CACHE = 'zs-settings-nav';

const nav = document.getElementById('tabs')!;
const main = document.getElementById('main')!;
let view: SettingsView | null = null;
let tab: Tab = 'start';
let poll = 0;
let query = '';
let remote: { groups: NavGroup[] | null; state: 'loading' | 'ok' | 'signed_out' | 'offline' } = { groups: readNavCache(), state: 'loading' };

function readNavCache(): NavGroup[] | null {
  try {
    const raw = localStorage.getItem(NAV_CACHE);
    const v = raw ? (JSON.parse(raw) as NavGroup[]) : null;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

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

/** Sin tildes ni mayúsculas; todas las palabras tienen que aparecer (como matchesSettingsQuery de la web). */
function matches(q: string, ...texts: Array<string | undefined>): boolean {
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(texts.filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

// ---------- Lista de secciones ----------

const tabKey = (t: Tab) => `${t[0].toUpperCase()}${t.slice(1)}`;
const tabLabel = (t: Tab) => s(`tab${tabKey(t)}`);

const search = h('input', {
  type: 'search',
  id: 'nav-search',
  class: 'nav-search',
  autocomplete: 'off',
  spellcheck: 'false',
  oninput: (e: Event) => {
    query = (e.target as HTMLInputElement).value;
    renderNavList();
  },
});
const searchLabel = h('label', { class: 'sr-only', for: 'nav-search' });
const navList = h('div', { class: 'nav-list', id: 'nav-list' });
nav.append(searchLabel, search, navList);

function navItems(): HTMLButtonElement[] {
  return Array.from(navList.querySelectorAll<HTMLButtonElement>('button.nav-item'));
}

function navButton(label: string, opts: { current?: boolean; id: string; onclick: () => void; swatch?: string; count?: number; web?: boolean }): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: `nav-item${opts.web ? ' web' : ''}`,
      id: opts.id,
      'aria-current': opts.current ? 'page' : undefined,
      onclick: opts.onclick,
    },
    opts.swatch ? h('i', { class: 'swatch', style: `background:${opts.swatch}`, 'aria-hidden': 'true' }) : null,
    h('span', { class: 'nav-label' }, label),
    opts.count ? h('span', { class: 'count' }, String(opts.count)) : null,
  );
}

function openWeb(href: string, btn: HTMLButtonElement) {
  btn.setAttribute('aria-busy', 'true');
  btn.classList.add('busy');
  void api.openWeb(href).catch(() => {
    btn.removeAttribute('aria-busy');
    btn.classList.remove('busy');
  });
}

function webButton(it: NavGroup['items'][number]): HTMLButtonElement {
  const b: HTMLButtonElement = navButton(it.label, {
    id: `web-${it.key}`,
    web: true,
    swatch: it.product ? (/^#[0-9a-f]{6}$/i.test(it.color ?? '') ? it.color : '#6e6e6e') : undefined,
    onclick: () => openWeb(it.href, b),
  });
  return b;
}

function renderNavList() {
  if (!view) return;
  searchLabel.textContent = s('searchSettings');
  search.placeholder = s('searchSettings');
  navList.textContent = '';
  const groups: Array<{ key: string; label: string; items: HTMLButtonElement[] }> = [];
  // Este dispositivo: las secciones nativas y, del servidor, Sin conexión.
  const device: HTMLButtonElement[] = [];
  for (const t of TABS) {
    if (!matches(query, tabLabel(t), s(`kw${tabKey(t)}`))) continue;
    const count = t === 'history' ? view.pending.length : t === 'updates' && (view.updateReady || view.update.available) ? 1 : 0;
    device.push(navButton(tabLabel(t), { id: `tab-${t}`, current: t === tab, onclick: () => go(t), count }));
  }
  const serverGroups = remote.groups ?? [];
  const serverDevice = serverGroups.find((g) => g.key === 'device');
  for (const it of serverDevice?.items ?? []) {
    if (it.native || !matches(query, it.label, it.keywords, serverDevice?.label)) continue;
    device.push(webButton(it));
  }
  groups.push({ key: 'device', label: serverDevice?.label ?? s('groupDevice'), items: device });
  for (const g of serverGroups) {
    if (g.key === 'device') continue;
    groups.push({ key: g.key, label: g.label, items: g.items.filter((it) => matches(query, it.label, it.keywords, g.label)).map(webButton) });
  }
  let shown = 0;
  for (const g of groups) {
    if (!g.items.length) continue;
    shown += g.items.length;
    const id = `nav-group-${g.key}`;
    navList.append(h('div', { class: 'nav-group', role: 'group', 'aria-labelledby': id }, h('p', { class: 'nav-heading', id }, g.label), ...g.items));
  }
  if (!shown) navList.append(h('p', { class: 'nav-note', role: 'status' }, s('noMatches', { q: query.trim() })));
  // Sin la lista del servidor: por qué faltan Cuenta, Workspace y Productos.
  if (!remote.groups && remote.state !== 'loading' && !query) {
    navList.append(
      h(
        'p',
        { class: 'nav-note' },
        remote.state === 'signed_out' ? s('navSignIn') : s('navOffline'),
        ' ',
        remote.state === 'signed_out'
          ? h('button', { class: 'btn link inline', type: 'button', onclick: () => void api.signIn() }, s('signIn'))
          : h('button', { class: 'btn link inline', type: 'button', onclick: () => void loadNav() }, s('retryLoad')),
      ),
    );
  }
}

async function loadNav() {
  remote = { ...remote, state: 'loading' };
  const res = await api.settingsNav().catch(() => null);
  if (res && res.ok) {
    remote = { groups: res.groups, state: 'ok' };
    try {
      localStorage.setItem(NAV_CACHE, JSON.stringify(res.groups));
    } catch {
      /* sin storage */
    }
  } else {
    const signedOut = Boolean(res && !res.ok && res.error === 'signed_out');
    // Sin sesión no se muestra la lista guardada (es de quien estaba antes).
    if (signedOut) {
      try {
        localStorage.removeItem(NAV_CACHE);
      } catch {
        /* sin storage */
      }
    }
    remote = { groups: signedOut ? null : remote.groups, state: signedOut ? 'signed_out' : 'offline' };
  }
  renderNavList();
}

nav.addEventListener('keydown', (e) => {
  const list = navItems();
  const active = document.activeElement;
  if (active === search) {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      search.value = '';
      query = '';
      renderNavList();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'Enter' && query && list[0]) {
      e.preventDefault();
      list[0].click();
    }
    return;
  }
  const i = list.indexOf(active as HTMLButtonElement);
  if (i < 0) return;
  if (e.key === 'ArrowUp' && i === 0) {
    e.preventDefault();
    search.focus();
    return;
  }
  let next: HTMLButtonElement | undefined;
  if (e.key === 'ArrowDown') next = list[i + 1];
  else if (e.key === 'ArrowUp') next = list[i - 1];
  else if (e.key === 'Home') next = list[0];
  else if (e.key === 'End') next = list[list.length - 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
});

function go(t: Tab) {
  tab = t;
  window.clearInterval(poll);
  if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
  const hadFocus = nav.contains(document.activeElement) && document.activeElement !== search;
  renderNavList();
  if (hadFocus) document.getElementById(`tab-${t}`)?.focus();
  main.setAttribute('aria-labelledby', `tab-${t}`);
  main.textContent = '';
  main.scrollTop = 0;
  const panel = h('div', { class: 'panel', 'data-panel': t });
  main.append(panel);
  if (t === 'start') renderStart(panel);
  else if (t === 'general') renderGeneral(panel);
  else if (t === 'meetings') renderMeetings(panel);
  else if (t === 'voice') void renderVoice(panel);
  else if (t === 'dictionary') void renderDictionary(panel);
  else if (t === 'history') void renderHistory(panel);
  else if (t === 'permissions') renderPermissions(panel);
  else if (t === 'privacy')
    void renderPrivacy(panel, {
      s,
      view: () => view!,
      alive: () => tab === 'privacy' && panel.isConnected,
      save: async (input) => {
        const res = await api.save(input);
        if (res.ok && res.view) view = res.view;
        return Boolean(res.ok && res.view);
      },
      // El permiso se pide y la sección se vuelve a pintar con el estado nuevo.
      ask,
    });
  else if (t === 'updates') renderUpdates(panel);
  else renderAccount(panel);
}

/** La copia que corre y su firma (para explicar por qué un permiso puede no reconocerse). */
function thisCopy(): string {
  const v = view!;
  const sig = v.signature === 'stable' ? s('sigStable') : v.signature === 'adhoc' ? s('sigAdhoc') : s('sigUnknown');
  return s('thisCopy', { v: v.version, sig });
}

/** Aviso de versión nueva: lista para instalar, o bajándose. */
function updateBanner(): HTMLElement | null {
  const v = view!;
  if (v.updateReady) {
    return h(
      'div',
      { class: 'notice info update-banner', id: 'update-banner', role: 'status' },
      h('span', {}, s('updateReadyLine', { v: v.updateReady })),
      h('button', { class: 'btn primary', type: 'button', onclick: () => void api.updateRestart() }, s('restartToUpdate')),
    );
  }
  if (v.update.available) {
    return h(
      'div',
      { class: 'notice info update-banner', id: 'update-banner', role: 'status' },
      h('span', {}, s('updateDownloading', { v: v.update.available })),
      tab === 'updates' ? null : h('button', { class: 'btn', type: 'button', onclick: () => go('updates') }, s('seeUpdates')),
    );
  }
  return null;
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
    const granted = acc === 'granted';
    // La llave prendida en Ajustes del Sistema puede ser de otra copia de zerosoft (una versión
    // anterior, u otra firma): siempre se explica y siempre está "Restablecer permiso", que borra
    // esa entrada y la pide de nuevo para esta copia.
    const why = v.accessibilityHint === 'updated' ? s('accessibilityUpdated') : v.accessibilityHint === 'adhoc' ? s('accessibilityAdhoc') : s('accessibilityStaleAny');
    const help = h(
      'span',
      {},
      s('stepAccessibilityHelp'),
      granted ? null : h('span', { class: 'step-note', id: 'acc-hint' }, why),
      granted ? null : h('span', { class: 'step-note muted', id: 'acc-copy' }, thisCopy()),
      v.signature === 'adhoc' ? h('span', { class: 'step-note muted' }, s('accessibilityAdhocUpdates')) : null,
    );
    const buttons = [
      h('button', { class: 'btn', type: 'button', onclick: () => void ask('accessibility') }, s('openSystemSettings')),
      h('button', { class: 'btn', type: 'button', id: 'acc-reset', onclick: () => void ask('accessibility-reset') }, s('accessibilityReset')),
      h('button', { class: 'btn link', type: 'button', onclick: () => void reload(false) }, s('checkAgain')),
    ];
    // Con tres botones van abajo, en su fila: al lado del título lo aplastan.
    step(granted, s('stepAccessibility'), help, [], granted ? undefined : h('div', { class: 'row step-row' }, ...buttons));
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
  const banner = updateBanner();
  panel.append(
    h('h1', {}, s('startTitle')),
    h('p', { class: 'lead' }, s('startIntro')),
    // La primera vez la ventana se abre sola: se dice por qué y dónde volver a encontrarla.
    ...(v.onboarded ? [] : [h('p', { class: 'notice info', id: 'first-run' }, s('firstRunNotice', { where: s(mac ? 'settingsWhereMac' : 'settingsWhereWin') }))]),
    ...(banner ? [banner] : []),
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
    if (tab === 'start' || tab === 'permissions' || tab === 'privacy') go(tab);
  }
}

// ---------- General ----------

function settingsSaver(st: HTMLElement, after?: () => void) {
  return async (input: SettingsInput) => {
    const res = await api.save(input);
    if (!res.ok || !res.view) return flash(st, s('saveFailed'), 'error');
    view = res.view;
    flash(st, s('saved'));
    after?.();
  };
}

function check(id: string, checked: boolean, text: string, key: keyof SettingsInput, save: (input: SettingsInput) => Promise<void>) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked, onchange: (e: Event) => void save({ [key]: (e.target as HTMLInputElement).checked }) }), h('span', {}, text));
}

function renderGeneral(panel: HTMLElement) {
  const v = view!;
  const st = status();
  const save = settingsSaver(st, () => {
    if (view?.shortcutTaken) go('general');
  });
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
  const banner = updateBanner();
  panel.append(
    h('div', { class: 'row' }, h('h1', {}, s('tabGeneral')), h('span', { class: 'spacer' }), st),
    h('p', { class: 'lead' }, s('holdHelp')),
    ...(banner ? [banner] : []),
    h('section', {}, h('h2', {}, s('mode')), ...modes),
    h(
      'section',
      {},
      h('h2', {}, s('dictation')),
      h('div', { class: 'grid2' }, h('div', {}, h('label', { class: 'field', for: 'shortcut' }, s('holdKey')), shortcut)),
      v.shortcutTaken ? h('p', { class: 'notice error' }, s('shortcutTaken')) : null,
      h('p', { class: 'help' }, s('handsFreeHelp')),
      h('p', { class: 'help' }, s('pasteLastHint'), ': ', kbd(v.pasteLastShortcut)),
      check('restore', v.restoreClipboard, s('restoreClipboard'), 'restoreClipboard', save),
    ),
    tabsSection(s, v.platform),
    h('section', {}, h('h2', {}, s('general')), check('login', v.openAtLogin, s('openAtLogin'), 'openAtLogin', save)),
    h(
      'section',
      { id: 'version-section' },
      h('h2', {}, s('currentVersion')),
      h(
        'div',
        { class: 'row' },
        h('span', { id: 'app-version', class: 'mono' }, s('versionLine', { v: v.version })),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn link', type: 'button', onclick: () => go('updates') }, `${s('tabUpdates')} →`),
      ),
    ),
    h('section', {}, h('h2', {}, s('settingsWhereTitle')), h('p', { class: 'help', style: 'margin:0' }, capitalize(s(v.platform === 'darwin' ? 'settingsWhereMac' : 'settingsWhereWin')), '.')),
  );
}

// ---------- Reuniones ----------

function renderMeetings(panel: HTMLElement) {
  const v = view!;
  const st = status();
  const save = settingsSaver(st);
  panel.append(
    h('div', { class: 'row' }, h('h1', {}, s('tabMeetings')), h('span', { class: 'spacer' }), st),
    h('p', { class: 'lead' }, s('meetingsIntro')),
    h(
      'section',
      {},
      check('indicator', v.recordingIndicator, s('recordingIndicator'), 'recordingIndicator', save),
      h(
        'div',
        { class: 'indicator-preview', 'aria-hidden': 'true' },
        h('span', { class: 'ind-chip' }, h('span', { class: 'ind-dot' })),
        h('span', { class: 'ind-chip open' }, h('span', { class: 'ind-clock' }, '12:34'), h('span', { class: 'ind-dot' })),
      ),
      h('p', { class: 'help' }, s('indicatorHowTo')),
    ),
    h('p', {}, h('button', { class: 'btn link', type: 'button', onclick: () => void api.openVoice('settings') }, `${s('openInVoice')} ↗`)),
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

// ---------- Permisos ----------

function permState(p: PermissionStatus): { text: string; cls: string } {
  if (p === 'granted') return { text: s('granted'), cls: 'ok' };
  if (p === 'not-determined') return { text: s('notDetermined'), cls: 'muted' };
  if (p === 'restricted') return { text: s('restricted'), cls: 'no' };
  return { text: s('notGranted'), cls: 'no' };
}

function renderPermissions(panel: HTMLElement) {
  const v = view!;
  panel.append(h('h1', {}, s('tabPermissions')));
  if (v.platform !== 'darwin') {
    panel.append(h('p', { class: 'lead' }, s('permNotNeeded')));
    return;
  }
  panel.append(h('p', { class: 'lead' }, s('permIntro')), h('p', { class: 'help', id: 'perm-copy', style: 'margin:-12px 0 16px' }, thisCopy()));
  const rows: Array<[PermissionKind, string, string]> = [
    ['accessibility', 'permAccessibility', 'permAccessibilityHelp'],
    ['microphone', 'permMic', 'permMicHelpFull'],
    ['camera', 'permCamera', 'permCameraHelp'],
    ['screen', 'permScreen', 'permScreenHelp'],
  ];
  const list = h('ul', { class: 'list perms', id: 'permissions' });
  for (const [kind, title, help] of rows) {
    const p = v.permissions[kind] ?? 'not-determined';
    const state = permState(p);
    const granted = p === 'granted';
    const askLabel = kind === 'microphone' && p === 'not-determined' ? s('allow') : s('openSystemSettings');
    list.append(
      h(
        'li',
        { 'data-perm': kind },
        h('div', { class: 'item-text' }, h('span', { class: 'perm-title' }, s(title)), h('span', { class: `perm-state ${state.cls}` }, state.text)),
        h('div', { class: 'item-meta' }, s(help)),
        h(
          'div',
          { class: 'item-actions' },
          granted ? null : h('button', { class: 'btn', type: 'button', onclick: () => void ask(kind) }, askLabel),
          // Restablecer siempre a mano: también cuando dice "permitido" pero algo no anda.
          h('button', { class: 'btn link', type: 'button', onclick: () => void ask(kind === 'accessibility' ? 'accessibility-reset' : `reset-${kind}`) }, s('accessibilityReset')),
        ),
      ),
    );
  }
  panel.append(
    list,
    h('p', { class: 'help' }, h('button', { class: 'btn link', type: 'button', style: 'padding:0', onclick: () => void reload(false) }, s('checkAgain'))),
    // Qué hace la app con cada permiso, cuándo lo usó y qué guarda y manda.
    h('p', {}, h('button', { class: 'btn link', type: 'button', id: 'perm-privacy', style: 'padding:0', onclick: () => go('privacy') }, `${s('tabPrivacy')} →`)),
  );
  if (v.permissions.accessibility !== 'granted') panel.append(h('p', { class: 'notice', id: 'perm-why' }, s('accessibilityStaleAny')));
  // Mientras falte algo, se relee (los cambios en Ajustes del Sistema no avisan).
  const missing = (['accessibility', 'microphone'] as const).some((k) => v.permissions[k] !== 'granted');
  if (missing) poll = window.setInterval(() => void reload(false), 2000);
}

// ---------- Actualizaciones ----------

function renderUpdates(panel: HTMLElement) {
  const v = view!;
  const u = v.update;
  const line = v.updateReady
    ? s('updateReadyLine', { v: v.updateReady })
    : u.available
      ? s('updateDownloading', { v: u.available })
      : u.checking
        ? s('checking')
        : u.failed
          ? s('checkFailed')
          : u.checkedAt
            ? s('upToDateLine')
            : s('notCheckedYet');
  const mode = v.updates === 'auto' ? s('updatesAuto') : v.updates === 'off' ? s('updatesOff') : s('updatesDev');
  panel.append(
    h('h1', {}, s('tabUpdates')),
    h('p', { class: 'lead' }, mode),
    h(
      'section',
      {},
      h('h2', {}, s('currentVersion')),
      h('p', { class: 'mono', id: 'app-version', style: 'margin:0' }, s('versionLine', { v: v.version })),
      h('p', { class: 'help' }, thisCopy()),
    ),
    h(
      'section',
      {},
      h('h2', {}, s('updates')),
      h('p', { id: 'update-state', role: 'status', 'aria-live': 'polite', class: u.failed ? 'error-text' : '' }, line),
      u.checkedAt && !u.checking ? h('p', { class: 'help' }, s('lastChecked', { t: timeAgo(u.checkedAt) })) : null,
      h(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        v.updateReady ? h('button', { class: 'btn primary', type: 'button', onclick: () => void api.updateRestart() }, s('restartToUpdate')) : null,
        v.updates === 'auto'
          ? h(
              'button',
              {
                class: `btn${v.updateReady ? '' : ' primary'}`,
                type: 'button',
                id: 'check-updates',
                disabled: u.checking,
                onclick: async () => {
                  const next = await api.updateCheck().catch(() => null);
                  if (next) view = next;
                  if (tab === 'updates') go('updates');
                },
              },
              u.checking ? s('checking') : s('checkUpdates'),
            )
          : h('button', { class: 'btn', type: 'button', onclick: () => void api.openVoice('download') }, s('downloadPage')),
      ),
    ),
  );
}

// ---------- Sesión y servidor ----------

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
    void loadNav();
  });
  // La sesión puede haber cambiado (login en el navegador, cierre en la web): se relee al abrir la sección.
  void api.get().then((next) => {
    if (!next || tab !== 'account') return;
    const changed = JSON.stringify(next.account) !== JSON.stringify(view?.account);
    view = next;
    if (changed) {
      go('account');
      void loadNav();
    }
  });
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
                  void loadNav();
                },
              },
              s('signOut'),
            )
          : h('button', { class: 'btn primary', type: 'button', onclick: () => void api.signIn() }, s('signIn')),
      ),
    ),
    h('section', {}, h('h2', {}, s('server')), form, h('p', { class: 'help' }, s('serverHelp'))),
  );
}

// ---------- Carga ----------

async function reload(rerender = true) {
  const v = await api.get();
  if (!v) return;
  const key = (x: SettingsView) => JSON.stringify([x.permissions, x.account, x.shortcutTaken, x.pending.length, x.update, x.updateReady]);
  const before = view ? key(view) : '';
  const signedBefore = view?.account.signedIn;
  view = v;
  document.documentElement.lang = v.locale;
  document.title = v.strings.settingsTitle;
  if (signedBefore !== undefined && signedBefore !== v.account.signedIn) void loadNav();
  // Solo se redibuja si cambió algo visible (no pisar lo que se está escribiendo).
  const live = tab === 'start' || tab === 'account' || tab === 'permissions' || tab === 'updates' || tab === 'general';
  if (rerender || (before !== key(v) && live)) go(tab);
  else renderNavList();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) window.close();
});

api.onRefresh(() => void reload(false));
api.onTab((t) => {
  if ((TABS as readonly string[]).includes(t)) go(t as Tab);
});

const fromHash = location.hash.slice(1);
if ((TABS as readonly string[]).includes(fromHash)) tab = fromHash as Tab;
void api.get().then((v) => {
  if (!v) return;
  view = v;
  document.documentElement.lang = v.locale;
  document.title = v.strings.settingsTitle;
  if (!fromHash) tab = v.onboarded ? 'general' : 'start';
  go(tab);
  void loadNav();
});
