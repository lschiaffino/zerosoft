/**
 * Dictados que no llegaron al servidor (sin conexión, sesión vencida, error
 * del servidor): el audio queda en <userData>/pending/<id>.audio con su
 * <id>.json, para mandarlo de nuevo desde la bandeja o el historial de
 * Ajustes. Tope de 20 y una semana (shared/retry.ts).
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { isPendingId, newPendingId, parsePendingMeta, prunePending, type DictationFailure, type PendingMeta } from '../shared/retry';

type Listener = () => void;
const listeners = new Set<Listener>();

function dir() {
  return path.join(app.getPath('userData'), 'pending');
}

function files(id: string) {
  return { audio: path.join(dir(), `${id}.audio`), meta: path.join(dir(), `${id}.json`) };
}

export function onPendingChange(fn: Listener) {
  listeners.add(fn);
}

function changed() {
  for (const fn of listeners) fn();
}

function removeFiles(id: string) {
  const f = files(id);
  fs.rmSync(f.audio, { force: true });
  fs.rmSync(f.meta, { force: true });
}

export function listPending(): PendingMeta[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const metas: PendingMeta[] = [];
  for (const n of names) {
    try {
      const m = parsePendingMeta(JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')));
      if (m && fs.existsSync(files(m.id).audio)) metas.push(m);
      else fs.rmSync(path.join(dir(), n), { force: true });
    } catch {
      /* archivo roto: se ignora */
    }
  }
  const { keep, drop } = prunePending(metas, Date.now());
  drop.forEach((m) => removeFiles(m.id));
  return keep;
}

export function savePending(input: { audio: Uint8Array; mime: string; durationMs: number; sourceApp: string; context: string; failure: DictationFailure }): PendingMeta | null {
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const meta: PendingMeta = {
      id: newPendingId(Date.now()),
      createdAt: Date.now(),
      mime: input.mime,
      durationMs: Math.round(input.durationMs),
      sourceApp: input.sourceApp.slice(0, 100),
      context: input.context,
      failure: input.failure,
      attempts: 0,
    };
    const f = files(meta.id);
    fs.writeFileSync(f.audio, Buffer.from(input.audio), { mode: 0o600 });
    fs.writeFileSync(f.meta, JSON.stringify(meta), { mode: 0o600 });
    listPending(); // poda
    changed();
    return meta;
  } catch {
    return null;
  }
}

export function readPending(id: unknown): { meta: PendingMeta; audio: Uint8Array } | null {
  if (!isPendingId(id)) return null;
  const meta = listPending().find((m) => m.id === id);
  if (!meta) return null;
  try {
    return { meta, audio: new Uint8Array(fs.readFileSync(files(id).audio)) };
  } catch {
    return null;
  }
}

export function markAttempt(id: string, failure: DictationFailure) {
  const m = listPending().find((x) => x.id === id);
  if (!m) return;
  try {
    fs.writeFileSync(files(id).meta, JSON.stringify({ ...m, failure, attempts: m.attempts + 1 }), { mode: 0o600 });
  } catch {
    /* sin disco */
  }
  changed();
}

export function discardPending(id: unknown): boolean {
  if (!isPendingId(id)) return false;
  removeFiles(id);
  changed();
  return true;
}
