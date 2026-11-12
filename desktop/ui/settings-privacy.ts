/**
 * Ajustes › Privacidad y datos (src-tauri/src/privacy.rs). Todo sale del estado real de la app:
 * los permisos y cuándo se usaron, lo guardado en esta computadora (ruta, tamaño, borrar), qué
 * sale y a dónde, y el registro de actividad. Los textos de cada fila son los hechos de
 * desktop/privacy-facts.json, los mismos de la página pública /download/privacy.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PermissionAsk, PermissionKind, SettingsInput, SettingsView } from './api';

type Locale = 'en' | 'es' | 'pt';
type Text = Record<string, string>;
type Localized<T> = { id: string; code: string[] } & Record<Locale, T>;

interface Facts {
  limits: Record<string, number>;
  permissions: Array<Localized<Text> & { os: string[]; pane?: PermissionKind }>;
  stores: Array<Localized<Text> & { content: boolean; delete: boolean; all: boolean }>;
  network: Array<Localized<Text> & { host: 'server' | 'update' | 'browser'; endpoints: string[] }>;
  never: Array<Localized<string>>;
  system: Array<Localized<string>>;
  indicators: Array<Localized<string>>;
  open: Array<Localized<string>>;
  events: Array<Localized<string>>;
  tags: Record<string, Record<Locale, string>>;
  controls: Array<Localized<Text>>;
}

interface StoreView {
  id: string;
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
  deletable: boolean;
}

interface EventView {
  at: number;
  kind: string;
  trigger?: string;
  result?: string;
  durationMs?: number;
  bytes?: number;
  host?: string;
  app?: string;
}

export interface PrivacyView {
  stores: StoreView[];
  usage: Record<string, { last: number; count: number }>;
  events: EventView[];
  facts: Facts;
  /** Clave del texto de lo que se captura ahora (trayMic…), o null. */
  capturing: string | null;
  /** Este arranque terminó un "borrar todo" (privacy.rs, WipeResult), o null. */
  lastWipe: { ok: boolean; leftovers: string[]; error: 'marker' | 'locked' | null } | null;
}

type Result = { ok: boolean; view?: PrivacyView; file?: string; restart?: boolean; requested?: boolean };
const call = (action: string, target?: string) => invoke<Result>('privacy', { action, target: target ?? null });

type Str = (key: string, vars?: Record<string, string | number>) => string;
type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k in e && typeof v !== 'string') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** "1,2 MB", "340 KB", "0 B". */
export function formatBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: i === 0 || v >= 100 ? 0 : 1 })} ${units[i]}`;
}

/** "0,4 s", "12 s", "3 min 05 s". */
export function formatDuration(ms: number, locale: string): string {
  if (ms < 1000) return `${(ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export interface PrivacyDeps {
  s: Str;
  view: () => SettingsView;
  save: (input: SettingsInput) => Promise<boolean>;
  ask: (kind: PermissionAsk) => Promise<void>;
  /** La sección sigue abierta. */
  alive: () => boolean;
}

let unlisten: (() => void) | null = null;

export async function renderPrivacy(panel: HTMLElement, deps: PrivacyDeps) {
  const { s } = deps;
  const v = deps.view();
  const locale = v.locale as Locale;
  const status = el('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const say = (text: string, kind: 'ok' | 'error' = 'ok') => {
    status.className = `status ${kind}`;
    status.textContent = text;
    if (kind === 'ok') window.setTimeout(() => (status.textContent === text ? (status.textContent = '') : null), 2500);
  };
  const body = el('div', { class: 'loading' }, s('loading'));
  panel.append(
    el('div', { class: 'row' }, el('h1', {}, s('tabPrivacy')), el('span', { class: 'spacer' }), status),
    el('p', { class: 'lead' }, s('privIntro'), ' ', el('button', { class: 'btn link inline', type: 'button', id: 'priv-docs', onclick: () => void call('open', 'docs') }, `${s('privReadMore')} ↗`)),
    body,
  );
  let data: PrivacyView | null = null;
  try {
    data = (await call('get')).view ?? null;
  } catch {
    data = null;
  }
  if (!deps.alive()) return;
  if (!data) {
    body.className = 'notice error';
    body.textContent = s('errLoad');
    return;
  }
  body.className = '';
  body.textContent = '';
  const facts = data.facts;
  const host = (() => {
    try {
      return new URL(v.server).host;
    } catch {
      return v.server;
    }
  })();
  const when = (ms: number) => new Date(ms).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const source = (code: string[]) =>
    el(
      'span',
      { class: 'priv-src' },
      `${s('privSource')}: `,
      ...code.flatMap((c, i) => [i ? ', ' : '', el('button', { class: 'btn link inline', type: 'button', title: c, onclick: () => void call('open', `source:${c}`) }, c.split('/').pop() ?? c)]),
    );
  /** Un botón que pide confirmar en el lugar antes de hacer algo que no se deshace. */
  let confirming = false;
  const confirmButton = (label: string, question: string, run: () => Promise<void>, cls = 'btn') => {
    const wrap = el('span', { class: 'priv-confirm' });
    const idle = () => {
      confirming = false;
      wrap.replaceChildren(
        el(
          'button',
          {
            class: cls,
            type: 'button',
            onclick: () => {
              confirming = true;
              const yes = el('button', { class: 'btn danger', type: 'button', onclick: () => void run().finally(idle) }, s('privConfirm'));
              const no = el('button', { class: 'btn link', type: 'button', onclick: idle }, s('privCancel'));
              wrap.replaceChildren(el('span', { class: 'priv-question', role: 'alert' }, question), yes, no);
              yes.focus();
            },
          },
          label,
        ),
      );
    };
    idle();
    return wrap;
  };
  const act = async (action: string, target: string, done: string) => {
    try {
      const r = await call(action, target);
      if (r.view) data = r.view;
      if (r.restart) return say(done);
      if (!r.ok) {
        say(target === 'all' ? s('privDeleteAllPartial') : s('privDeleteFailed'), 'error');
        return paint();
      }
      say(r.file ? s('privExported', { file: r.file }) : r.requested ? s('privRequested') : done);
      paint();
      // El webview no avisa cuándo terminó: se vuelve a medir un rato después.
      if (r.requested)
        window.setTimeout(async () => {
          const again = await call('get').catch(() => null);
          if (again?.view && deps.alive()) {
            data = again.view;
            paint();
          }
        }, 3000);
    } catch {
      say(s('privDeleteFailed'), 'error');
    }
  };

  // ---------- Ahora ----------
  const now = el('p', { id: 'priv-now', role: 'status' });
  const wipe = el('p', { id: 'priv-last-wipe', role: 'status', hidden: true });

  // ---------- Permisos ----------
  const perms = el('ul', { class: 'list perms', id: 'priv-permissions' });

  // ---------- Lo que decidís vos ----------
  const controls = el('div', { id: 'priv-controls' });
  const tabsPrefs = { restore: true };
  const control = (id: string, checked: boolean, onchange: (on: boolean) => Promise<boolean>) => {
    const c = facts.controls.find((x) => x.id === id);
    if (!c) return null;
    const input = el('input', { type: 'checkbox', id: `priv-${id}`, checked });
    input.addEventListener('change', async () => {
      const ok = await onchange(input.checked).catch(() => false);
      if (ok) say(s('saved'));
      else {
        input.checked = !input.checked;
        say(s('saveFailed'), 'error');
      }
    });
    return el('div', { class: 'priv-control' }, el('label', { class: 'check', for: `priv-${id}` }, input, el('span', {}, c[locale].name)), el('p', { class: 'help check-help' }, c[locale].help));
  };
  const paintControls = () => {
    const cur = deps.view();
    const mac = cur.platform === 'darwin';
    const setting = (id: keyof SettingsInput & keyof SettingsView) => control(id, Boolean(cur[id]), (on) => deps.save({ [id]: on }));
    controls.replaceChildren(
      ...[
        mac ? setting('sendAppName') : null,
        setting('keepFailedDictations'),
        mac ? setting('allowSystemAudio') : null,
        setting('restoreClipboard'),
        control('restoreTabs', tabsPrefs.restore, async (on) => {
          const next = (await invoke('tabs_prefs_save', { input: { restore: on } })) as { restore: boolean };
          tabsPrefs.restore = next.restore;
          return next.restore === on;
        }),
        setting('openAtLogin'),
      ].filter((x): x is HTMLDivElement => !!x),
    );
  };
  void (invoke('tabs_prefs_get') as Promise<{ restore: boolean }>).then((p) => {
    tabsPrefs.restore = p.restore;
    if (deps.alive()) paintControls();
  });

  // ---------- En esta computadora ----------
  const stores = el('ul', { class: 'list priv-stores', id: 'priv-stores' });

  // ---------- Registro ----------
  const log = el('div', { id: 'priv-log' });
  let showAll = false;

  const paint = () => {
    if (!data) return;
    const cur = deps.view();
    now.className = data.capturing ? 'notice info' : 'help';
    now.textContent = data.capturing ? s('privCapturing', { what: s(data.capturing) }) : s('privNotCapturing');
    const lw = data.lastWipe;
    wipe.hidden = !lw;
    if (lw) {
      const names = lw.leftovers.map((id) => facts.stores.find((x) => x.id === id)?.[locale].name ?? id).join(', ');
      const failed = !lw.ok;
      wipe.className = failed || names ? 'notice error' : 'notice info';
      wipe.textContent = [failed ? s(lw.error === 'marker' ? 'privLastWipeMarker' : 'privLastWipeFailed') : s('privLastWipeOk'), names ? s('privLastWipeLeftovers', { list: names }) : ''].filter(Boolean).join(' ');
    }

    perms.replaceChildren(
      ...facts.permissions.map((p) => {
        const st = p.pane ? cur.permissions[p.pane] : 'not-needed';
        const needs = st !== 'not-needed';
        const stateText = !needs ? s('privNoPermission') : st === 'granted' ? s('granted') : st === 'not-determined' ? s('notDetermined') : st === 'restricted' ? s('restricted') : s('notGranted');
        const cls = !needs ? 'muted' : st === 'granted' ? 'ok' : st === 'not-determined' ? 'muted' : 'no';
        const u = data!.usage[p.id];
        const tracked = ['microphone', 'accessibility', 'screen', 'camera', 'clipboard'].includes(p.id);
        return el(
          'li',
          { 'data-perm': p.id },
          el('div', { class: 'item-text' }, el('span', { class: 'perm-title' }, p[locale].name), el('span', { class: `perm-state ${cls}` }, stateText)),
          el(
            'div',
            { class: 'item-meta' },
            p[locale].why,
            tracked ? el('span', { class: 'priv-used' }, u ? s('privLastUsed', { when: when(u.last), n: u.count }) : s('privNeverUsed')) : null,
            source(p.code),
          ),
          needs && p.pane
            ? el(
                'div',
                { class: 'item-actions' },
                el('button', { class: 'btn', type: 'button', onclick: () => void deps.ask(p.pane!) }, s('openSystemSettings')),
                el('button', { class: 'btn link', type: 'button', onclick: () => void deps.ask(p.pane === 'accessibility' ? 'accessibility-reset' : `reset-${p.pane!}`) }, s('accessibilityReset')),
              )
            : null,
        );
      }),
    );

    paintControls();

    stores.replaceChildren(
      ...facts.stores.map((f) => {
        const st = data!.stores.find((x) => x.id === f.id);
        const isSwitch = f.id === 'autostart';
        const size = !st
          ? s('privNotOnThisSystem')
          : isSwitch
            ? st.exists
              ? s('privOn')
              : s('privOff')
            : st.exists
              ? `${formatBytes(st.bytes, locale)}${st.files > 1 ? ` · ${s('privFiles', { n: st.files })}` : ''}`
              : s('privEmptyStore');
        const del =
          st?.deletable && st.exists
            ? f.id === 'web_data'
              ? confirmButton(s('privDeleteWeb'), s('privDeleteWebConfirm'), () => act('delete', f.id, s('privDeleted')))
              : f.id === 'activity'
                ? confirmButton(s('privClear'), s('privClearConfirm'), () => act('delete', f.id, s('privCleared')))
                : confirmButton(s('privDelete'), `${s('privDelete')}: ${f[locale].name}?`, () => act('delete', f.id, s('privDeleted')))
            : null;
        return el(
          'li',
          { 'data-store': f.id },
          el('div', { class: 'item-text' }, el('span', { class: 'perm-title' }, f[locale].name), el('span', { class: 'perm-state muted', 'data-size': '' }, size)),
          el(
            'div',
            { class: 'item-meta' },
            f[locale].what,
            el('span', { class: 'priv-used' }, f[locale].kept),
            el('span', { class: 'priv-used' }, f.content ? s('privContent') : s('privMetadata')),
            f.all ? el('span', { class: 'priv-used' }, s('privAll')) : null,
            st?.path ? el('code', { class: 'priv-path' }, st.path) : null,
            source(f.code),
          ),
          el('div', { class: 'item-actions' }, st?.path ? el('button', { class: 'btn link', type: 'button', onclick: () => void call('reveal', f.id) }, s('privShow')) : null, del),
        );
      }),
    );

    const events = showAll ? data.events : data.events.slice(0, 40);
    const label = (kind: string) => facts.events.find((e) => e.id === kind)?.[locale] ?? kind;
    const tag = (t?: string) => (t ? (facts.tags[t]?.[locale] ?? t) : '');
    const total = data.events.length;
    log.replaceChildren(
      total
        ? el(
            'ul',
            { class: 'list priv-events', id: 'priv-events' },
            ...events.map((e) =>
              el(
                'li',
                { 'data-kind': e.kind },
                el('div', { class: 'item-text' }, label(e.kind)),
                el(
                  'div',
                  { class: 'item-meta' },
                  [when(e.at), tag(e.trigger), tag(e.result), e.durationMs !== undefined ? formatDuration(e.durationMs, locale) : '', e.bytes !== undefined ? formatBytes(e.bytes, locale) : '', e.host ?? '', e.app ?? '']
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
            ),
          )
        : el('p', { class: 'empty' }, s('privActivityEmpty')),
      ...(!showAll && total > events.length
        ? [
            el(
              'p',
              {},
              el(
                'button',
                {
                  class: 'btn link',
                  type: 'button',
                  id: 'priv-show-all',
                  onclick: () => {
                    showAll = true;
                    paint();
                  },
                },
                s('privShowAll', { n: total }),
              ),
            ),
          ]
        : []),
    );
  };

  const plain = (items: Array<Localized<string>>, id: string) => el('ul', { class: 'priv-plain', id }, ...items.map((i) => el('li', { 'data-id': i.id }, i[locale], ' ', source(i.code))));
  const hostText = (h: string) => (h === 'server' ? s('privYourServer', { host }) : h === 'update' ? s('privUpdateHost', { host }) : s('privBrowser'));
  const network = el(
    'ul',
    { class: 'list priv-network', id: 'priv-network' },
    ...facts.network.map((n) =>
      el(
        'li',
        { 'data-net': n.id },
        el('div', { class: 'item-text' }, el('span', { class: 'perm-title' }, n[locale].feature)),
        el(
          'div',
          { class: 'item-meta' },
          n[locale].sent,
          el('span', { class: 'priv-used' }, `${s('privWhen')}: ${n[locale].when}`),
          el('span', { class: 'priv-used' }, `${s('privTo')}: ${hostText(n.host)}`),
          n.endpoints.length ? el('code', { class: 'priv-path' }, n.endpoints.join(', ')) : null,
          source(n.code),
        ),
      ),
    ),
  );

  body.append(
    wipe,
    now,
    el('section', {}, el('h2', {}, s('privPermissions')), perms),
    el('section', {}, el('h2', {}, s('privControls')), controls),
    el(
      'section',
      {},
      el('h2', {}, s('privStores')),
      el('p', { class: 'help', style: 'margin:0 0 10px' }, s('privStoresHelp')),
      stores,
      el('p', { class: 'help' }, s('privDeleteAllHelp')),
      el('p', { id: 'priv-delete-all' }, confirmButton(s('privDeleteAll'), s('privDeleteAllConfirm'), () => act('delete', 'all', s('privDeleted')), 'btn danger-outline')),
    ),
    el('section', {}, el('h2', {}, s('privNetwork')), el('p', { class: 'help', style: 'margin:0 0 10px' }, s('privNetworkHelp', { server: v.server })), network),
    el('section', {}, el('h2', {}, s('privIndicators')), plain(facts.indicators, 'priv-indicators')),
    el('section', {}, el('h2', {}, s('privNever')), plain(facts.never, 'priv-never')),
    el('section', {}, el('h2', {}, s('privSystem')), plain(facts.system, 'priv-system')),
    el('section', {}, el('h2', {}, s('privOpen')), plain(facts.open, 'priv-open')),
    el(
      'section',
      {},
      el(
        'div',
        { class: 'row' },
        el('h2', { style: 'margin:0' }, s('privActivity')),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', id: 'priv-export', onclick: () => void act('export', '', '') }, s('privExport')),
        confirmButton(s('privClear'), s('privClearConfirm'), () => act('delete', 'activity', s('privCleared'))),
      ),
      el('p', { class: 'help', style: 'margin:6px 0 10px' }, s('privActivityHelp', { n: facts.limits.activityEvents, d: facts.limits.activityDays })),
      log,
    ),
  );
  paint();

  // Algo nuevo en el registro: se relee (sin pisar una confirmación a medias).
  unlisten?.();
  let pending = 0;
  const stop = await listen('privacy://refresh', () => {
    window.clearTimeout(pending);
    pending = window.setTimeout(async () => {
      if (!deps.alive()) return unlisten?.();
      if (confirming) return;
      const r = await call('get').catch(() => null);
      if (r?.view && deps.alive() && !confirming) {
        data = r.view;
        paint();
      }
    }, 400);
  });
  unlisten = () => {
    stop();
    unlisten = null;
  };
}
