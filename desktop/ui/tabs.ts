/**
 * Tira de pestañas de una ventana (src-tauri/src/tabs.rs). Rust la redibuja con
 * window.__zsTabs.render(view) y ella le pide acciones por IPC (tabs_action). Sin
 * dependencias: el test e2e (tests/e2e/desktop-tabs.spec.ts) la carga con el IPC simulado.
 */

interface TabView {
  id: number;
  title: string;
  path: string;
  product: string;
  loaded: boolean;
  unread: boolean;
  recording: boolean;
}

interface View {
  active: number;
  fullscreen: boolean;
  tabs: TabView[];
}

interface Init {
  platform: 'darwin' | 'win32';
  locale: string;
  strings: Record<string, string>;
  view: View;
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invoke: Invoke = (cmd, args) => {
  const i = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  return i ? i.invoke(cmd, args ?? {}) : Promise.reject(new Error('ipc'));
};
const act = (action: string, args: Record<string, unknown> = {}) => void invoke('tabs_action', { action, ...args }).catch(() => {});

/** Productos por segmento de /app/<x> (nombre y color de lib/products.ts). */
const PRODUCTS: Record<string, [string, string]> = {
  track: ['Track', '#f2611d'],
  crm: ['CRM', '#7b4dff'],
  chat: ['Chat', '#e23d7f'],
  groups: ['Groups', '#65a30d'],
  lines: ['Lines', '#65a30d'],
  agents: ['Agents', '#ff3b30'],
  flow: ['Flow', '#0284c7'],
  robots: ['Robots', '#6b7280'],
  links: ['Link', '#2f6bff'],
  docs: ['Docs', '#c2700a'],
  notes: ['Notes', '#e6b400'],
  calendar: ['Cal', '#0e9f6e'],
  board: ['Board', '#00b8a9'],
  voice: ['Voice', '#c026d3'],
  inbox: ['Inbox', '#3d5a80'],
  rec: ['Rec', '#e11d48'],
  talk: ['Talk', '#8e3a80'],
  design: ['Design', '#00a5c8'],
  shop: ['Shop', '#15803d'],
  analytics: ['Analytics', '#4f46e5'],
  pulse: ['Pulse', '#4f46e5'],
  social: ['Social', '#7e22ce'],
  hiring: ['Hiring', '#0f766e'],
  people: ['People', '#8b5e34'],
  books: ['Books', '#1e3a8a'],
  sign: ['Sign', '#7f1d1d'],
  forms: ['Forms', '#6e730d'],
  send: ['Send', '#0b7285'],
  calls: ['Calls', '#a61e4d'],
};

let S: Record<string, string> = {};
let view: View = { active: 0, fullscreen: false, tabs: [] };
let pending: View | null = null;
let dragging = false;
const list = document.getElementById('tabs') as HTMLDivElement;
const newBtn = document.getElementById('new') as HTMLButtonElement;

/** "Deals · CRM · zerosoft" → "Deals · CRM". Sin título: el producto o "Pestaña nueva". */
export function tabTitle(t: Pick<TabView, 'title' | 'product'>, strings: Record<string, string> = S): string {
  const clean = t.title.replace(/\s*[·|–-]\s*zerosoft\s*$/i, '').trim();
  if (clean && clean.toLowerCase() !== 'zerosoft') return clean;
  return PRODUCTS[t.product]?.[0] ?? strings.tabNewTitle ?? 'New tab';
}

function svgClose(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M1 1l6 6M7 1L1 7');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.4');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  return svg;
}

function icon(t: TabView): HTMLElement {
  const el = document.createElement('span');
  const prod = PRODUCTS[t.product];
  el.className = prod ? 'icon' : 'icon home';
  el.setAttribute('aria-hidden', 'true');
  if (prod) {
    el.style.background = prod[1];
    el.textContent = prod[0].slice(0, 1);
  } else {
    el.textContent = 'z';
  }
  if (t.unread && !t.recording) {
    const b = document.createElement('span');
    b.className = 'badge';
    el.append(b);
  }
  return el;
}

function tabEl(t: TabView, active: boolean): HTMLElement {
  const title = tabTitle(t);
  const el = document.createElement('div');
  el.className = 'tab' + (t.loaded || active ? '' : ' asleep');
  el.dataset.id = String(t.id);
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', String(active));
  el.tabIndex = active ? 0 : -1;
  const extra = [t.recording ? S.tabRecording : '', t.unread ? S.tabUnread : '', !t.loaded && !active ? S.tabSuspended : ''].filter(Boolean);
  el.setAttribute('aria-label', [title, ...extra].join('. '));
  el.title = [title, ...extra].join('\n');
  el.append(icon(t));
  if (t.recording) {
    const r = document.createElement('span');
    r.className = 'rec';
    r.setAttribute('aria-hidden', 'true');
    el.append(r);
  }
  const span = document.createElement('span');
  span.className = 'title';
  span.textContent = title;
  el.append(span);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'close';
  x.tabIndex = -1;
  x.setAttribute('aria-label', S.closeTab ?? 'Close tab');
  x.title = S.closeTab ?? 'Close tab';
  x.append(svgClose());
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    act('close', { id: t.id });
  });
  x.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.append(x);
  return el;
}

function narrow() {
  for (const el of list.querySelectorAll<HTMLElement>('.tab')) el.classList.toggle('narrow', el.getBoundingClientRect().width < 76);
}

export function render(v: View) {
  if (dragging) {
    pending = v;
    return;
  }
  view = v;
  document.body.dataset.fullscreen = String(!!v.fullscreen);
  // Por id y en el lugar: una pestaña que se está apretando (arrastre por empezar) no pierde el puntero.
  const old = new Map(tabs().map((el) => [el.dataset.id, el]));
  const els = v.tabs.map((t) => {
    const fresh = tabEl(t, t.id === v.active);
    const prev = old.get(String(t.id));
    if (!prev) return fresh;
    prev.className = fresh.className;
    for (const a of ['aria-selected', 'aria-label', 'title']) prev.setAttribute(a, fresh.getAttribute(a) ?? '');
    prev.tabIndex = fresh.tabIndex;
    prev.replaceChildren(...fresh.childNodes);
    return prev;
  });
  const same = els.length === list.children.length && els.every((el, i) => list.children[i] === el);
  if (!same) {
    const focused = (document.activeElement as HTMLElement | null)?.closest?.('.tab') as HTMLElement | null;
    list.replaceChildren(...els);
    focused?.isConnected && focused.focus();
  }
  narrow();
}

function tabs(): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('.tab')];
}

// ---------- Mouse: activar, cerrar con el del medio, menú, arrastrar ----------

const DRAG_START = 4;
/** Cuánto hay que alejarse de la tira para sacar la pestaña a otra ventana. */
const DETACH = 28;

list.addEventListener('pointerdown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!el || e.button !== 0) return;
  const id = Number(el.dataset.id);
  const startX = e.clientX;
  const startY = e.clientY;
  const all = tabs();
  const from = all.indexOf(el);
  const rects = all.map((t) => t.getBoundingClientRect());
  const width = rects[from].width;
  let started = false;
  let target = from;
  let outside = false;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* sin captura, window igual recibe los eventos */
  }
  if (Number(el.dataset.id) !== view.active) act('activate', { id });

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!started) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      started = true;
      dragging = true;
      el.classList.add('dragging');
      for (const t of all) if (t !== el) t.classList.add('shift');
    }
    const bar = (list.parentElement ?? list).getBoundingClientRect();
    outside = ev.clientY < bar.top - DETACH || ev.clientY > bar.bottom + DETACH || ev.clientX < bar.left - DETACH || ev.clientX > bar.right + DETACH;
    el.style.transform = `translate(${dx}px, ${outside ? dy : 0}px)`;
    el.style.opacity = outside ? '0.85' : '';
    // Lugar nuevo: por el centro de la arrastrada contra los centros de las demás.
    const center = rects[from].left + width / 2 + dx;
    target = from;
    rects.forEach((r, i) => {
      if (i < from && center < r.left + r.width / 2) target = Math.min(target, i);
      if (i > from && center > r.left + r.width / 2) target = Math.max(target, i);
    });
    all.forEach((t, i) => {
      if (t === el) return;
      let shift = 0;
      if (!outside && i > from && i <= target) shift = -width;
      if (!outside && i < from && i >= target) shift = width;
      t.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!started) return;
    dragging = false;
    for (const t of all) {
      t.style.transform = '';
      t.style.opacity = '';
      t.classList.remove('shift', 'dragging');
    }
    if (outside) {
      act('drop', { id, x: ev.screenX, y: ev.screenY });
    } else if (target !== from) {
      // Al toque en pantalla; Rust confirma con el render siguiente.
      const next = [...view.tabs];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      pending = null;
      render({ ...view, tabs: next });
      act('move', { id, index: target });
      return;
    }
    if (pending) {
      const p = pending;
      pending = null;
      render(p);
    }
  };
  // En window (y con captura): el puntero sigue contando fuera de la pestaña y de la tira.
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

list.addEventListener('auxclick', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (el && e.button === 1) {
    e.preventDefault();
    act('close', { id: Number(el.dataset.id) });
  }
});

list.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (el) act('menu', { id: Number(el.dataset.id) });
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Doble clic en una pestaña: nada (como Safari); en el espacio libre lo maneja la región de arrastre.
newBtn.addEventListener('click', () => act('new'));

// ---------- Teclado ----------

list.addEventListener('keydown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!el) return;
  const all = tabs();
  const i = all.indexOf(el);
  const id = Number(el.dataset.id);
  let next = -1;
  if (e.key === 'ArrowRight') next = (i + 1) % all.length;
  else if (e.key === 'ArrowLeft') next = (i - 1 + all.length) % all.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = all.length - 1;
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    act('activate', { id });
    return;
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    act('close', { id });
    return;
  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    act('menu', { id });
    return;
  }
  if (next >= 0) {
    e.preventDefault();
    for (const t of all) t.tabIndex = -1;
    all[next].tabIndex = 0;
    all[next].focus();
  }
});

new ResizeObserver(narrow).observe(list);

const api = { render };
Object.defineProperty(window, '__zsTabs', { value: api });

void (invoke('tabs_ready') as Promise<Init>)
  .then((init) => {
    S = init.strings ?? {};
    document.documentElement.lang = init.locale || 'en';
    document.body.dataset.platform = init.platform;
    list.setAttribute('aria-label', S.tabsLabel ?? 'Tabs');
    newBtn.setAttribute('aria-label', S.newTab ?? 'New tab');
    newBtn.title = S.newTab ?? 'New tab';
    render(init.view);
  })
  .catch(() => {});
