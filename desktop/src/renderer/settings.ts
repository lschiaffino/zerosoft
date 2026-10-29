/** Ajustes y bienvenida del escritorio. Esc cierra, Enter guarda. */
import type { PermissionKind, SettingsInput, SettingsView } from '../shared/ipc';

declare global {
  interface Window {
    zsSettings: {
      get: () => Promise<SettingsView | null>;
      save: (input: SettingsInput) => Promise<{ ok: boolean; error?: string; view?: SettingsView }>;
      ask: (kind: PermissionKind) => Promise<SettingsView | null>;
      onRefresh: (cb: () => void) => void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const msg = $<HTMLSpanElement>('msg');
let view: SettingsView | null = null;

const PERMS: Array<{ kind: PermissionKind; name: string; help: string }> = [
  { kind: 'microphone', name: 'permMic', help: 'permMicHelp' },
  { kind: 'accessibility', name: 'permAccessibility', help: 'permAccessibilityHelp' },
  { kind: 'screen', name: 'permScreen', help: 'permScreenHelp' },
];

function renderPerms(v: SettingsView) {
  const s = v.strings;
  const wrap = $('perms');
  wrap.textContent = '';
  for (const p of PERMS) {
    const status = v.permissions[p.kind];
    if (status === 'not-needed') continue;
    const row = document.createElement('div');
    row.className = 'perm';
    const name = document.createElement('div');
    name.className = 'perm-name';
    name.textContent = s[p.name];
    const badge = document.createElement('span');
    const ok = status === 'granted';
    badge.className = `status ${ok ? 'granted' : 'denied'}`;
    badge.textContent = ok ? s.granted : s.notGranted;
    name.append(badge);
    row.append(name);
    if (!ok) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.kind === 'microphone' && status === 'not-determined' ? s.allow : s.openSystemSettings;
      btn.addEventListener('click', async () => {
        const next = await window.zsSettings.ask(p.kind);
        if (next) render(next, false);
      });
      row.append(btn);
    } else row.append(document.createElement('span'));
    const help = document.createElement('div');
    help.className = 'perm-help';
    help.textContent = s[p.help];
    row.append(help);
    wrap.append(row);
  }
  $('perm-section').hidden = !wrap.childElementCount;
}

function render(v: SettingsView, fields = true) {
  view = v;
  const s = v.strings;
  document.documentElement.lang = v.locale;
  document.title = s.settingsTitle;
  $('title').textContent = s.settingsTitle;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = s[el.dataset.t!] ?? '';
  });
  renderPerms(v);
  $('toggle').textContent = v.toggleShortcut.replace(/\+/g, ' + ');
  if (!fields) return;
  const select = $<HTMLSelectElement>('hotkey');
  select.textContent = '';
  for (const h of v.hotkeys) {
    const o = document.createElement('option');
    o.value = h.id;
    o.textContent = h.label;
    select.append(o);
  }
  select.value = v.hotkey;
  $<HTMLInputElement>('alerts').checked = v.meetingAlerts;
  $<HTMLInputElement>('login').checked = v.openAtLogin;
  $<HTMLInputElement>('server').value = v.server;
}

async function load(fields = true) {
  const v = await window.zsSettings.get();
  if (v) render(v, fields);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!view) return;
  msg.className = 'msg';
  msg.textContent = '';
  const res = await window.zsSettings.save({
    server: $<HTMLInputElement>('server').value,
    hotkey: $<HTMLSelectElement>('hotkey').value as SettingsInput['hotkey'],
    meetingAlerts: $<HTMLInputElement>('alerts').checked,
    openAtLogin: $<HTMLInputElement>('login').checked,
  });
  if (!res.ok) {
    msg.className = 'msg error';
    msg.textContent = res.error === 'server' ? view.strings.serverInvalid : '';
    $('server').focus();
    return;
  }
  if (res.view) render(res.view);
  msg.textContent = view.strings.saved;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

// Al volver de Ajustes del Sistema se relee el estado de los permisos (sin pisar lo que se está editando).
window.zsSettings.onRefresh(() => void load(false));
void load();
