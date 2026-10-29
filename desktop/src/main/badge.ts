/**
 * Contador del dock / barra de tareas y avisos nativos.
 *
 * Cada 30 s (y al cambiar el foco) pide GET /api/desktop/badge?since=… con la
 * sesión: menciones y DMs sin leer de Talk, avisos sin leer de la campana, y
 * los avisos nuevos desde la última vez. Con la ventana sin foco, cada aviso
 * nuevo sale como notificación del sistema; el clic abre su página.
 */
import { app, nativeImage, Notification, type BrowserWindow } from 'electron';
import { fill } from '../shared/strings';
import { safeAppPath } from '../shared/nav';
import { apiJson } from './api';
import { getMainWindow, t, TEST_MODE } from './state';
import { testHooks } from './test-hooks';
import { openAppPath } from './window';

interface BadgeResponse {
  total: number;
  talk: number;
  bell: number;
  notifications: Array<{ id: string; title: string; body: string | null; href: string | null; createdAt: string }>;
  now: string;
}

const POLL_MS = 30_000;
const MAX_TOASTS = 3;
let since: string | null = null;
let timer: NodeJS.Timeout | null = null;
let lastCount = -1;
const shown = new Set<string>();

function overlayDot(): Electron.NativeImage {
  // Punto para el ícono de la barra de tareas de Windows (16×16, BGRA).
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const i = (y * size + x) * 4;
      if (d <= 7) {
        buf[i] = 0x2b; // B
        buf[i + 1] = 0x2b; // G
        buf[i + 2] = 0xd9; // R
        buf[i + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function setBadge(count: number) {
  const n = Math.max(0, Math.min(Math.floor(count) || 0, 9999));
  if (n === lastCount) return;
  lastCount = n;
  testHooks.badge = n;
  if (process.platform === 'darwin' || process.platform === 'linux') {
    app.setBadgeCount(n);
  } else if (process.platform === 'win32') {
    const win = getMainWindow();
    win?.setOverlayIcon(n ? overlayDot() : null, n ? String(n) : '');
  }
}

function notify(title: string, body: string, onClick: () => void) {
  if (TEST_MODE) {
    testHooks.notifications.push({ title, body, click: onClick });
    return;
  }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', onClick);
  n.show();
}

/** Aviso del sistema que abre una página de la app (o la app) al hacer clic. */
export function notifyOpen(title: string, body: string, href: string | null) {
  const target = safeAppPath(href ?? '') ?? '/app';
  notify(title, body, () => openAppPath(target));
}

export async function pollBadge(): Promise<void> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const { status, data } = await apiJson<BadgeResponse>(`/api/desktop/badge${qs}`);
  if (status === 401) {
    setBadge(0);
    since = null;
    return;
  }
  if (status !== 200 || !data) return;
  setBadge(data.total);
  const first = since === null;
  since = data.now;
  // La primera respuesta solo marca desde cuándo: lo viejo no se anuncia al abrir la app.
  if (first) {
    data.notifications.forEach((n) => shown.add(n.id));
    return;
  }
  const win: BrowserWindow | null = getMainWindow();
  const focused = !!win && win.isFocused() && win.isVisible();
  const fresh = data.notifications.filter((n) => !shown.has(n.id));
  fresh.forEach((n) => shown.add(n.id));
  if (focused || !fresh.length) return;
  if (fresh.length > MAX_TOASTS) {
    notifyOpen('zerosoft', fill(t().newNotifications, { n: fresh.length }), '/app');
    return;
  }
  for (const n of fresh) notifyOpen(n.title, n.body ?? '', n.href);
}

export function startBadgePolling() {
  if (timer) return;
  void pollBadge();
  timer = setInterval(() => void pollBadge(), POLL_MS);
}

export function stopBadgePolling() {
  if (timer) clearInterval(timer);
  timer = null;
  since = null;
  setBadge(0);
}
