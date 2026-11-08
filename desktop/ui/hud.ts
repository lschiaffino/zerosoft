/**
 * HUD de dictado: solo muestra. El micrófono lo graba la app en Rust; acá llegan el estado
 * (hud://state) y el nivel (hud://level, cada 50 ms) para el medidor y el reloj (ámbar los
 * últimos 10 s).
 */
import { listen } from '@tauri-apps/api/event';
import { formatClock, type HudState } from './api';

const label = document.getElementById('label')!;
const clock = document.getElementById('clock')!;
const hint = document.getElementById('hint')!;
const bars = Array.from(document.querySelectorAll<HTMLSpanElement>('.meter span'));

let clockTimer = 0;
let startedAt: number | null = null;
let maxMs = 120_000;

function paintClock() {
  if (startedAt === null) {
    clock.textContent = '';
    return;
  }
  const ms = Date.now() - startedAt;
  clock.textContent = formatClock(ms);
  clock.classList.toggle('ending', maxMs - ms <= 10_000);
}

void listen<HudState>('hud://state', (e) => {
  const s = e.payload;
  document.body.dataset.phase = s.phase;
  label.textContent = s.label;
  hint.textContent = s.phase === 'recording' ? s.hint : '';
  maxMs = s.maxMs;
  window.clearInterval(clockTimer);
  if (s.phase === 'recording') {
    // Pasar a manos libres no reinicia el reloj.
    if (s.startedAt) startedAt = s.startedAt;
    paintClock();
    clockTimer = window.setInterval(paintClock, 250);
  } else {
    startedAt = null;
    clock.textContent = '';
    bars.forEach((b) => (b.style.height = '3px'));
  }
});

void listen<number>('hud://level', (e) => {
  if (document.body.dataset.phase !== 'recording') return;
  const peak = Number(e.payload) || 0;
  const now = Date.now();
  bars.forEach((b, i) => {
    const wave = 0.55 + 0.45 * Math.sin(now / 120 + i * 1.3);
    b.style.height = `${Math.max(3, Math.min(18, 3 + peak * 44 * wave))}px`;
  });
});
