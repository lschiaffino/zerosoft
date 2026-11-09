/**
 * Ajustes › General › Pestañas y ventanas (src-tauri/src/tabs.rs): restaurar al abrir, pausar las
 * pestañas quietas y qué abre el ⌘-clic. Se guarda al momento, como el resto de Ajustes.
 */
import { invoke } from '@tauri-apps/api/core';

export interface TabsPrefs {
  suspend: boolean;
  suspendMinutes: number;
  restore: boolean;
  links: 'tab' | 'window';
}

const MINUTES = [5, 15, 30, 60, 240];

type Str = (key: string, vars?: Record<string, string | number>) => string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function keys(platform: string) {
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl+';
  const k = (t: string) => el('kbd', {}, t);
  return { t: k(`${mod}T`), n: k(`${mod}N`), w: k(`${mod}W`), r: k(platform === 'darwin' ? '⌘⇧T' : 'Ctrl+Shift+T'), k: k(platform === 'darwin' ? '⌘1…9' : 'Ctrl+1…9') };
}

/** Texto con {x} reemplazados por nodos. */
function fill(text: string, nodes: Record<string, Node>): Array<Node | string> {
  return text.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && nodes[m[1]] ? nodes[m[1]] : part;
  });
}

export function tabsSection(s: Str, platform: string): HTMLElement {
  const section = el('section', { id: 'tabs-section' });
  const status = el('span', { className: 'status', role: 'status' });
  status.setAttribute('aria-live', 'polite');
  section.append(el('div', { className: 'row' }, el('h2', { style: 'margin:0' } as never, s('tabsSection')), el('span', { className: 'spacer' }), status));
  const body = el('div', { className: 'loading' }, '…');
  section.append(body);

  const save = async (patch: Partial<TabsPrefs>) => {
    try {
      const next = (await invoke('tabs_prefs_save', { input: patch })) as TabsPrefs;
      draw(next);
      status.className = 'status ok';
      status.textContent = s('tabsSaved');
    } catch {
      status.className = 'status error';
      status.textContent = s('saveFailed');
    }
  };

  const draw = (p: TabsPrefs) => {
    const check = (id: string, checked: boolean, text: string, key: keyof TabsPrefs) => {
      const input = el('input', { type: 'checkbox', id, checked });
      input.addEventListener('change', () => void save({ [key]: input.checked }));
      return el('label', { className: 'check', htmlFor: id }, input, el('span', {}, text));
    };
    const after = el('select', { id: 'tabs-after', disabled: !p.suspend });
    for (const m of MINUTES) after.append(el('option', { value: String(m), selected: m === p.suspendMinutes }, m < 60 ? s('tabsMinutes', { n: m }) : m === 60 ? s('tabsHour') : s('tabsHours', { n: m / 60 })));
    after.addEventListener('change', () => void save({ suspendMinutes: Number(after.value) }));
    const mod = platform === 'darwin' ? '⌘' : 'Ctrl';
    const links = (['tab', 'window'] as const).map((v) => {
      const input = el('input', { type: 'radio', name: 'tabs-links', value: v, checked: p.links === v });
      input.addEventListener('change', () => void save({ links: v }));
      return el('label', { className: 'radio' }, input, el('span', {}, s(v === 'tab' ? 'tabsLinksTab' : 'tabsLinksWindow')));
    });
    const [lead, rest] = s('tabsLinks').split('{key}');
    body.className = '';
    body.replaceChildren(
      check('tabs-restore', p.restore, s('tabsRestore'), 'restore'),
      check('tabs-suspend', p.suspend, s('tabsSuspend'), 'suspend'),
      el('p', { className: 'help check-help' }, s('tabsSuspendHelp')),
      el('div', { className: 'row', style: 'margin:6px 0 10px 23px' } as never, el('label', { htmlFor: 'tabs-after' }, s('tabsSuspendAfter')), el('div', { style: 'width:160px' } as never, after)),
      el('fieldset', { style: 'border:0;margin:6px 0 0;padding:0' } as never, el('legend', { className: 'field', style: 'padding:0;margin-bottom:2px;font-weight:500' } as never, lead, el('kbd', {}, mod), rest ?? ''), ...links),
      el('p', { className: 'help' }, ...fill(s('tabsKeys'), keys(platform))),
    );
  };

  void (invoke('tabs_prefs_get') as Promise<TabsPrefs>).then(draw).catch(() => {
    body.className = 'notice error';
    body.textContent = s('saveFailed');
  });
  return section;
}
