/**
 * Reuniones al estilo Granola: avisar cuando empieza una y abrir Voice
 * grabando micrófono + audio del sistema, sin bot en la llamada.
 *
 * - Calendario: cada minuto GET /api/voice/events (Cal, Google y Outlook
 *   conectados). Un evento que empieza ahora y no tiene reunión de Voice da
 *   un aviso.
 * - App en uso: cada 15 s, procesos (Zoom crea CptHost solo en llamada) y
 *   títulos de ventanas (Meet en el navegador, Teams). En Mac los títulos
 *   necesitan el permiso de Grabación de pantalla: sin él solo se mira Zoom.
 *
 * "Tomar notas" abre /app/voice?event=…|new=1&autostart=desktop: la página
 * crea la reunión y el grabador de la web empieza con "micrófono + audio
 * del sistema" (el handler de captura de window.ts da el loopback). Las
 * notas quedan en Voice igual que una grabación web.
 */
import { desktopCapturer, systemPreferences } from 'electron';
import { execFile } from 'child_process';
import { currentEvent, detectMeetingApp, dueEvents, type CalendarEventLite, type MeetingApp } from '../shared/meetings';
import { fill } from '../shared/strings';
import { apiJson } from './api';
import { getSettings } from './config';
import { notifyOpen } from './badge';
import { getMainWindow, t } from './state';
import { openAppPath } from './window';

const EVENTS_MS = 60_000;
const DETECT_MS = 15_000;
const APP_NAMES: Record<MeetingApp, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' };

let events: CalendarEventLite[] = [];
const notified = new Set<string>();
let lastApp: MeetingApp | null = null;
let timers: NodeJS.Timeout[] = [];

export function startNotes(eventKey?: string | null) {
  const qs = eventKey ? `event=${encodeURIComponent(eventKey)}` : 'new=1';
  openAppPath(`/app/voice?${qs}&autostart=desktop`);
}

/** La ventana ya está en una reunión de Voice (grabando o por grabar): no hace falta avisar. */
function onMeetingPage(): boolean {
  const url = getMainWindow()?.webContents.getURL() ?? '';
  return /\/app\/voice\/meetings\/[^/?#]+/.test(url);
}

async function pollEvents() {
  if (!getSettings().meetingAlerts) return;
  const { status, data } = await apiJson<{ events?: CalendarEventLite[] }>('/api/voice/events');
  if (status !== 200 || !Array.isArray(data?.events)) return;
  events = data.events.slice(0, 50);
  for (const e of dueEvents(events, Date.now(), notified)) {
    notified.add(e.key);
    notifyOpen(e.title || 'zerosoft', t().meetingSoonBody, `/app/voice?event=${encodeURIComponent(e.key)}&autostart=desktop`);
  }
}

function processes(): Promise<string[]> {
  return new Promise((resolve) => {
    const [cmd, args] = process.platform === 'win32' ? ['tasklist', ['/fo', 'csv', '/nh']] : ['ps', ['-Aco', 'command']];
    execFile(cmd, args as string[], { timeout: 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const lines = String(stdout).split(/\r?\n/).filter(Boolean);
      resolve(process.platform === 'win32' ? lines.map((l) => l.split('","')[0].replace(/^"/, '')) : lines);
    });
  });
}

async function windowTitles(): Promise<string[]> {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return [];
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    return sources.map((s) => s.name);
  } catch {
    return [];
  }
}

async function detect() {
  if (!getSettings().meetingAlerts) return;
  const [procs, titles] = await Promise.all([processes(), windowTitles()]);
  const app = detectMeetingApp({ processes: procs, windowTitles: titles });
  if (app && app !== lastApp && !onMeetingPage()) {
    const ev = currentEvent(events, Date.now());
    if (ev) notified.add(ev.key);
    notifyOpen(
      fill(t().meetingDetectedTitle, { app: APP_NAMES[app] }),
      t().meetingDetectedBody,
      `/app/voice?${ev && !ev.sessionId ? `event=${encodeURIComponent(ev.key)}` : 'new=1'}&autostart=desktop`,
    );
  }
  lastApp = app;
}

export function startMeetingWatch() {
  if (timers.length) return;
  void pollEvents();
  timers = [setInterval(() => void pollEvents(), EVENTS_MS), setInterval(() => void detect(), DETECT_MS)];
}

export function stopMeetingWatch() {
  timers.forEach(clearInterval);
  timers = [];
}
