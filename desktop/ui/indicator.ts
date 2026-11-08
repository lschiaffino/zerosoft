/**
 * Indicador de grabación: "Grabando 12:34 · Abrir · Cortar". Lo muestra y esconde la app
 * (src-tauri/src/indicator.rs); acá solo se pinta el estado y se mandan las acciones.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { formatClock } from './api';

interface Recording {
  startedAt: number;
  path: string;
}

const label = document.getElementById('label')!;
const clock = document.getElementById('clock')!;
const open = document.getElementById('open') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
const hide = document.getElementById('hide') as HTMLButtonElement;
let rec: Recording | null = null;
let timer = 0;

function tick() {
  clock.textContent = rec ? formatClock(Date.now() - rec.startedAt) : '';
}

function paint(next: Recording | null) {
  rec = next;
  document.body.dataset.on = String(!!rec);
  stop.disabled = false;
  window.clearInterval(timer);
  tick();
  if (rec) timer = window.setInterval(tick, 1000);
}

const act = (action: 'open' | 'stop' | 'hide') => void invoke('indicator_action', { action });
open.addEventListener('click', () => act('open'));
stop.addEventListener('click', () => {
  stop.disabled = true;
  act('stop');
});
hide.addEventListener('click', () => act('hide'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') act('hide');
});

void listen<Recording | null>('indicator://state', (e) => paint(e.payload));
void invoke<{ recording: Recording | null; strings: Record<string, string> }>('indicator_state').then((v) => {
  const s = (k: string) => v.strings[k] ?? k;
  label.textContent = s('indicatorRecording');
  open.textContent = s('indicatorOpen');
  stop.textContent = s('indicatorStop');
  hide.setAttribute('aria-label', s('indicatorHide'));
  hide.title = s('indicatorHide');
  paint(v.recording);
});
