/**
 * Barra flotante de Rec (como la de Loom): punto rojo y reloj, micrófono (nivel; clic silencia),
 * mostrar u ocultar la burbuja de la cámara, pausar o seguir, empezar de nuevo y descartar (con
 * confirmación) y Terminar (termina y abre la grabación). La muestra y mueve la app
 * (src-tauri/src/rec_overlay.rs); acá solo se pinta el estado y se mandan las acciones, que la app
 * le pasa a la página que graba.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { formatClock } from './api';

interface RecView {
  phase: 'countdown' | 'recording' | 'paused' | 'finishing';
  elapsedMs: number;
  at: number;
  mic: 'on' | 'muted' | 'none';
  camera: boolean;
  bubbleVisible: boolean;
  bubbleLarge: boolean;
}

type Action = 'pause' | 'resume' | 'stop' | 'restart' | 'discard' | 'mute' | 'unmute' | 'bubble-show' | 'bubble-hide' | 'open';

const $ = (id: string) => document.getElementById(id)!;
const clock = $('clock');
const stateEl = $('state');
const level = $('level');
const btn = {
  mic: $('mic') as HTMLButtonElement,
  camera: $('camera') as HTMLButtonElement,
  pause: $('pause') as HTMLButtonElement,
  restart: $('restart') as HTMLButtonElement,
  discard: $('discard') as HTMLButtonElement,
  finish: $('finish') as HTMLButtonElement,
  keep: $('keep') as HTMLButtonElement,
  yes: $('yes') as HTMLButtonElement,
};

let view: RecView | null = null;
let strings: Record<string, string> = {};
let mac = true;
let asking: 'discard' | 'restart' | null = null;
let timer = 0;
const s = (k: string) => strings[k] ?? k;
const act = (action: Action) => void invoke('rec_overlay_action', { action });
const key = (letter: string) => (mac ? `⌥⇧${letter}` : `Alt+Shift+${letter}`);

function label(el: HTMLElement, text: string) {
  el.setAttribute('aria-label', text);
  el.title = text;
}

function elapsed(): number {
  if (!view) return 0;
  return view.elapsedMs + (view.phase === 'recording' ? Math.max(0, Date.now() - view.at) : 0);
}

function tick() {
  clock.textContent = view ? formatClock(elapsed()) : '';
}

function paint() {
  document.body.dataset.on = String(!!view);
  if (!view) {
    window.clearInterval(timer);
    return;
  }
  const v = view;
  document.body.dataset.phase = v.phase;
  document.body.dataset.mic = v.mic;
  stateEl.textContent = s(v.phase === 'countdown' ? 'recStarting' : v.phase === 'paused' ? 'recPaused' : v.phase === 'finishing' ? 'recFinishing' : 'recRecording');
  const live = v.phase === 'recording' || v.phase === 'paused';
  // Micrófono: clic silencia o activa.
  ($('mic-off') as unknown as SVGElement).style.display = v.mic === 'on' ? 'none' : '';
  btn.mic.disabled = v.mic === 'none' || v.phase === 'finishing';
  label(btn.mic, s(v.mic === 'none' ? 'recNoMic' : v.mic === 'muted' ? 'recUnmute' : 'recMute'));
  // Burbuja de la cámara.
  btn.camera.hidden = !v.camera;
  label(btn.camera, s(v.bubbleVisible ? 'recHideCamera' : 'recShowCamera'));
  btn.camera.setAttribute('aria-pressed', String(v.bubbleVisible));
  // Pausar o seguir.
  const paused = v.phase === 'paused';
  ($('pause-icon') as unknown as SVGElement).style.display = paused ? 'none' : '';
  ($('resume-icon') as unknown as SVGElement).style.display = paused ? '' : 'none';
  label(btn.pause, `${s(paused ? 'recResume' : 'recPause')} (${key('P')})`);
  for (const b of [btn.pause, btn.restart, btn.discard, btn.finish]) b.disabled = !live;
  label(btn.restart, s('recRestart'));
  label(btn.discard, s('recDiscard'));
  btn.finish.textContent = s('recFinish');
  btn.finish.title = `${s('recFinishHint')} (${key('S')})`;
  if (!live) ask(null);
  window.clearInterval(timer);
  tick();
  if (v.phase === 'recording') timer = window.setInterval(tick, 250);
}

/** Confirmar descartar o empezar de nuevo, en la misma barra. */
function ask(what: 'discard' | 'restart' | null) {
  asking = what;
  $('main').hidden = !!what;
  $('confirm').hidden = !what;
  if (!what) return;
  $('ask').textContent = s(what === 'discard' ? 'recDiscardConfirm' : 'recRestartConfirm');
  btn.keep.textContent = s('recKeep');
  btn.yes.textContent = s(what === 'discard' ? 'recDiscard' : 'recRestart');
}

btn.mic.addEventListener('click', () => view && act(view.mic === 'muted' ? 'unmute' : 'mute'));
btn.camera.addEventListener('click', () => view && act(view.bubbleVisible ? 'bubble-hide' : 'bubble-show'));
btn.pause.addEventListener('click', () => view && act(view.phase === 'paused' ? 'resume' : 'pause'));
btn.restart.addEventListener('click', () => ask('restart'));
btn.discard.addEventListener('click', () => ask('discard'));
btn.finish.addEventListener('click', () => act('stop'));
btn.keep.addEventListener('click', () => ask(null));
btn.yes.addEventListener('click', () => {
  if (asking) act(asking);
  ask(null);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && asking) ask(null);
});

// Arrastrar desde cualquier parte que no sea un botón; un clic sin mover abre zerosoft.
let down: { x: number; y: number } | null = null;
$('bar').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
  down = { x: e.screenX, y: e.screenY };
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
    down = null;
    void getCurrentWindow().startDragging();
  }
});
window.addEventListener('mouseup', () => {
  if (down) act('open');
  down = null;
});

void listen<RecView>('rec://state', (e) => {
  view = e.payload;
  paint();
});
void listen<number>('rec://level', (e) => {
  const n = Math.max(0, Math.min(1, Number(e.payload) || 0));
  level.style.transform = `scaleX(${n.toFixed(2)})`;
});
void invoke<{ view: RecView | null; platform: string; strings: Record<string, string> }>('rec_overlay_state').then((v) => {
  strings = v.strings;
  mac = v.platform === 'darwin';
  document.documentElement.lang = strings.lang ?? document.documentElement.lang;
  label($('bar'), s('recControls'));
  btn.keep.textContent = s('recKeep');
  view = v.view;
  paint();
});
