/**
 * Indicador de grabación: un rectángulo negro con un punto rojo. Clic abre la reunión; con el
 * mouse encima se estira y muestra el tiempo; clic derecho (o la tecla de menú) ofrece Abrir,
 * Cortar y Ocultar; se arrastra a cualquier lado. Lo muestra, mueve y esconde la app
 * (src-tauri/src/indicator.rs); acá solo se pinta el estado y se mandan las acciones.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { formatClock } from './api';

interface Recording {
  startedAt: number;
  path: string;
}

type Action = 'open' | 'stop' | 'hide' | 'menu' | 'expand' | 'collapse';

const chip = document.getElementById('chip') as HTMLButtonElement;
const clock = document.getElementById('clock')!;
let rec: Recording | null = null;
let timer = 0;
let strings: Record<string, string> = {};
const s = (k: string) => strings[k] ?? k;

const act = (action: Action) => void invoke('indicator_action', { action });

function tick() {
  const t = rec ? formatClock(Date.now() - rec.startedAt) : '';
  clock.textContent = t;
  // Lectores de pantalla y el globo del sistema: "Grabando 12:34. Clic para abrir".
  const label = rec ? `${s('indicatorRecording')} ${t}. ${s('indicatorClickToOpen')}` : '';
  chip.setAttribute('aria-label', label);
  chip.title = label;
}

function paint(next: Recording | null) {
  rec = next;
  document.body.dataset.on = String(!!rec);
  window.clearInterval(timer);
  tick();
  if (rec) timer = window.setInterval(tick, 1000);
}

function setOpen(open: boolean) {
  if (document.body.dataset.open === String(open)) return;
  document.body.dataset.open = String(open);
  act(open ? 'expand' : 'collapse');
}

// Arrastrar o hacer clic: si el mouse se mueve más de 3px con el botón apretado, se arrastra la
// ventana (el sistema la mueve); si no, es un clic y abre la reunión.
let down: { x: number; y: number } | null = null;
chip.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY };
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
    down = null;
    void getCurrentWindow().startDragging();
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !down) return;
  down = null;
  act('open');
});
// Teclado (Enter o espacio con el foco en el rectángulo).
chip.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    act('open');
  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    act('menu');
  }
});
chip.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  down = null;
  act('menu');
});
document.documentElement.addEventListener('mouseenter', () => setOpen(true));
document.documentElement.addEventListener('mouseleave', () => setOpen(false));
chip.addEventListener('focus', () => setOpen(true));
chip.addEventListener('blur', () => setOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') act('hide');
});

void listen<Recording | null>('indicator://state', (e) => paint(e.payload));
void invoke<{ recording: Recording | null; strings: Record<string, string> }>('indicator_state').then((v) => {
  strings = v.strings;
  document.documentElement.lang = strings.lang ?? document.documentElement.lang;
  paint(v.recording);
});
