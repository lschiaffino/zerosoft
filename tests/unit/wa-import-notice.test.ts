import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, getNumberRowById } from '@/lib/groups';
import { activeImports, getImportStatus, queueImport, runImportChunk, type ImportStatus } from '@/lib/groups-import';
import { IMPORT_IDLE_MS, importNoticeBusy, inboxImportNotice, linesImportNotice, type InboxImportLike, type LinesImportLike } from '@/lib/wa-import-notice';
import { buildEvolutionData, evolutionImportResponse } from '../support/evolution-fake';
import { makeUser } from './helpers';

/**
 * El aviso de importación de la lista de chats (Lines e Inbox). El caso que lo
 * motivó: "Importando mensajes: 20 de 20 chats" con la barra llena, que no se
 * iba ni se podía cerrar.
 */

const BRIDGE = 'https://bridge.example.test';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('GROUPS_BRIDGE_URL', BRIDGE);
  vi.stubEnv('GROUPS_BRIDGE_KEY', 'global');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubEvolution(data = buildEvolutionData()) {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const r = evolutionImportResponse(data, init.method ?? 'GET', u.pathname, u.searchParams, body, BRIDGE);
    if (r?.bytes) return new Response(new Uint8Array(r.bytes), { status: 200, headers: { 'content-type': r.type ?? 'application/octet-stream' } });
    if (r) return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    if (u.pathname.startsWith('/instance/connectionState')) return Response.json({ instance: { state: 'open' } });
    return Response.json({});
  });
}

async function connectedNumber(tag: string) {
  const user = await makeUser(tag);
  const n = await createNumber(user.id, user.id, { provider: 'managed' });
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { user, row: (await getNumberRowById(n.id))! };
}

const release = (numberId: string) => getDb().prepare('UPDATE groups_imports SET claimed_until = NULL WHERE number_id = ?').run(numberId);

describe('Lines: qué dice el aviso en cada tramo de una importación real', () => {
  it('con todos los chats contados la importación sigue en curso (fotos, miembros, historial viejo): el aviso ya no dice "importando mensajes"', async () => {
    stubEvolution(buildEvolutionData({ chats: 18, groups: 2, perChat: 4 }));
    const { row } = await connectedNumber('notice-phases');
    await queueImport(row);
    const trail: Array<{ st: ImportStatus; kind: string; percent: number | null }> = [];
    for (let i = 0; i < 400; i++) {
      // Un paso por tanda, como cuando cada corrida llega justo al tope de tiempo.
      const st = await runImportChunk(row.id, { budgetMs: 1 });
      if (!st) break;
      const n = linesImportNotice(st);
      trail.push({ st, kind: n.kind, percent: n.percent });
      if (st.status === 'done' || st.status === 'error') break;
    }
    // La causa: después del último chat quedan tandas "running" con 20 de 20 (fase pictures y después older).
    const full = trail.filter((x) => x.st.status === 'running' && x.st.chatsTotal === 20 && x.st.chatsDone === 20);
    expect(full.some((x) => x.st.phase === 'pictures')).toBe(true);
    expect(full.length).toBeGreaterThan(1);
    // Ninguna de esas se anuncia como avance de mensajes ni dibuja una barra llena.
    for (const x of full) {
      expect(['finishing', 'older']).toContain(x.kind);
      expect(x.percent).toBeNull();
    }
    // Mientras de verdad trae mensajes, sí hay avance con barra.
    expect(trail.some((x) => x.kind === 'progress' && x.percent !== null && x.percent > 0 && x.percent < 100)).toBe(true);
    expect(trail.at(-1)).toMatchObject({ kind: 'done' });
  }, 120_000);

  it('una línea que se desconecta a mitad de camino deja anotado por qué espera, y sigue sola al reconectar', async () => {
    stubEvolution(buildEvolutionData({ chats: 18, groups: 2, perChat: 4 }));
    const { user, row } = await connectedNumber('notice-dropped');
    await queueImport(row);
    for (let i = 0; i < 400; i++) {
      const st = await runImportChunk(row.id, { budgetMs: 1 });
      if (st?.phase === 'pictures') break;
    }
    await getDb().prepare("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?").run(row.id);
    // Pasan las corridas del cron y la fila sigue "running" con 20 de 20: antes, sin ningún rastro de por qué.
    for (let i = 0; i < 3; i++) {
      await release(row.id);
      await runImportChunk(row.id, { budgetMs: 1000 });
    }
    const waiting = (await getImportStatus(user.id, row.id))!;
    expect(waiting).toMatchObject({ status: 'running', phase: 'pictures', chatsDone: 20, chatsTotal: 20, error: 'not_connected' });
    expect(linesImportNotice(waiting)).toMatchObject({ kind: 'paused', tone: 'bad', percent: null });
    // La bandeja la sigue recibiendo (para poder decirlo).
    expect((await activeImports(user.id)).map((x) => x.numberId)).toContain(row.id);

    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(row.id);
    let last: ImportStatus | null = null;
    for (let i = 0; i < 400; i++) {
      await release(row.id);
      last = await runImportChunk(row.id, { budgetMs: 60_000 });
      if (!last || last.status === 'done' || last.status === 'error') break;
    }
    expect(last).toMatchObject({ status: 'done', error: '' });
    expect(linesImportNotice(last!).kind).toBe('done');
  }, 120_000);

  it('sin avance guardado hace rato se marca trabada; una que se cortó se sigue avisando un día', async () => {
    stubEvolution(buildEvolutionData({ chats: 2, groups: 0, perChat: 2 }));
    const { user, row } = await connectedNumber('notice-idle');
    await queueImport(row);
    expect((await getImportStatus(user.id, row.id))?.idle).toBe(false);
    const old = new Date(Date.now() - IMPORT_IDLE_MS - 60_000).toISOString();
    await getDb().prepare('UPDATE groups_imports SET updated_at = ? WHERE number_id = ?').run(old, row.id);
    const idle = (await getImportStatus(user.id, row.id))!;
    expect(idle.idle).toBe(true);
    expect(linesImportNotice(idle).kind).toBe('stalled');

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await getDb().prepare("UPDATE groups_imports SET status = 'error', error = 'provider_unavailable', finished_at = ? WHERE number_id = ?").run(hoursAgo(3), row.id);
    const failed = (await activeImports(user.id)).find((x) => x.numberId === row.id);
    expect(failed && linesImportNotice(failed)).toMatchObject({ kind: 'failed', tone: 'bad' });
    expect(failed?.idle).toBe(false);
    await getDb().prepare('UPDATE groups_imports SET finished_at = ? WHERE number_id = ?').run(hoursAgo(30), row.id);
    expect((await activeImports(user.id)).some((x) => x.numberId === row.id)).toBe(false);
    // Una que terminó bien se avisa solo un rato.
    await getDb().prepare("UPDATE groups_imports SET status = 'done', error = '', finished_at = ? WHERE number_id = ?").run(hoursAgo(1), row.id);
    expect((await activeImports(user.id)).some((x) => x.numberId === row.id)).toBe(false);
  });
});

describe('Lines: el aviso según el estado', () => {
  const base: LinesImportLike = { numberId: 'n1', status: 'running', phase: 'messages', chatsTotal: 20, chatsDone: 7, messages: 300, error: '', startedAt: '2026-11-19T10:00:00.000Z' };
  const kind = (patch: Partial<LinesImportLike>) => linesImportNotice({ ...base, ...patch }).kind;

  it('cada estado tiene su aviso', () => {
    expect(linesImportNotice(base)).toMatchObject({ kind: 'progress', tone: 'info', percent: 35, done: 7, total: 20 });
    expect(kind({ status: 'queued', phase: 'groups', chatsTotal: 0, chatsDone: 0 })).toBe('counting');
    expect(kind({ phase: 'contacts', chatsDone: 0 })).toBe('counting');
    expect(kind({ chatsDone: 20 })).toBe('finishing');
    expect(kind({ phase: 'pictures', chatsDone: 20 })).toBe('finishing');
    expect(kind({ phase: 'older', chatsDone: 20 })).toBe('older');
    expect(kind({ phase: 'pictures', chatsDone: 20, error: 'not_connected' })).toBe('paused');
    expect(kind({ error: 'provider_unavailable' })).toBe('stalled');
    expect(kind({ idle: true })).toBe('stalled');
    expect(linesImportNotice({ ...base, status: 'error', error: 'provider_unavailable' })).toMatchObject({ kind: 'failed', tone: 'bad', percent: null });
    expect(linesImportNotice({ ...base, status: 'done', phase: 'done', chatsDone: 20 })).toMatchObject({ kind: 'done', tone: 'done', percent: null });
    expect(kind({ status: 'done', phase: 'done', chatsDone: 20, messages: 0 })).toBe('nothingNew');
  });

  it('la barra nunca pasa de 100 ni se dibuja sin total', () => {
    expect(linesImportNotice({ ...base, chatsDone: 19 }).percent).toBe(95);
    expect(linesImportNotice({ ...base, chatsTotal: 0, chatsDone: 0 }).percent).toBeNull();
    // Dos ids del mismo chat pueden dejar la cuenta un paso corrida: el total nunca queda por debajo de lo hecho.
    expect(linesImportNotice({ ...base, chatsDone: 21, phase: 'older' })).toMatchObject({ done: 21, total: 21 });
  });

  it('lo cerrado vale para esa importación: otra importación de la misma línea avisa de nuevo, y un problema avisa aunque se haya cerrado el avance', () => {
    const progress = linesImportNotice(base);
    const done = linesImportNotice({ ...base, status: 'done', phase: 'done', chatsDone: 20 });
    const older = linesImportNotice({ ...base, phase: 'older', chatsDone: 20 });
    expect(done.key).toBe(progress.key);
    expect(older.key).toBe(progress.key);
    const failed = linesImportNotice({ ...base, status: 'error', error: 'provider_unavailable' });
    const paused = linesImportNotice({ ...base, error: 'not_connected' });
    expect(failed.key).not.toBe(progress.key);
    expect(paused.key).toBe(failed.key);
    const again = linesImportNotice({ ...base, startedAt: '2026-11-19T12:00:00.000Z' });
    expect(again.key).not.toBe(progress.key);
    expect(linesImportNotice({ ...base, numberId: 'n2' }).key).not.toBe(progress.key);
  });
});

describe('Inbox: el aviso según el estado', () => {
  const now = Date.parse('2026-11-19T12:00:00.000Z');
  const base: InboxImportLike = { id: 'imp1', kind: 'whatsapp', status: 'running', progress: { chats: 20, chatsDone: 5, messages: 80 }, error: '', finishedAt: null };
  const at = (patch: Partial<InboxImportLike>) => inboxImportNotice({ ...base, ...patch }, now);

  it('cada estado tiene su aviso', () => {
    expect(at({})).toMatchObject({ kind: 'progress', percent: 25, source: 'whatsapp' });
    expect(at({ kind: 'gmail' })).toMatchObject({ kind: 'progress', source: 'gmail' });
    expect(at({ progress: {} })?.kind).toBe('counting');
    expect(at({ status: 'waiting', error: 'history_syncing', progress: {} })?.kind).toBe('waiting');
    // Con la cuenta desconectada la importación espera para siempre: no es "importando 20 de 20".
    expect(at({ status: 'waiting', error: 'not_connected', progress: { chats: 20, chatsDone: 20 } })).toMatchObject({ kind: 'paused', tone: 'bad', percent: null });
    expect(at({ status: 'waiting', kind: 'gmail', error: 'gmail_reconnect' })?.kind).toBe('paused');
    expect(at({ error: 'whatsapp_unreachable' })?.kind).toBe('stalled');
    expect(at({ idle: true })?.kind).toBe('stalled');
    expect(at({ status: 'failed', error: 'whatsapp_unreachable', finishedAt: '2026-11-19T11:00:00.000Z' })).toMatchObject({ kind: 'failed', tone: 'bad' });
    expect(at({ status: 'done', progress: { chats: 20, chatsDone: 20, messages: 80 }, finishedAt: '2026-11-19T11:59:00.000Z' })).toMatchObject({ kind: 'done', tone: 'done', total: 20, percent: null });
  });

  it('no avisa de lo que no corresponde: archivos, pausadas a mano, canceladas y lo que terminó hace más de un día', () => {
    expect(at({ kind: 'file' })).toBeNull();
    expect(at({ status: 'paused' })).toBeNull();
    expect(at({ status: 'cancelled', finishedAt: '2026-11-19T11:00:00.000Z' })).toBeNull();
    expect(at({ status: 'done', finishedAt: '2026-11-17T11:00:00.000Z' })).toBeNull();
    expect(at({ status: 'failed', finishedAt: '2026-11-17T11:00:00.000Z' })).toBeNull();
  });

  it('solo lo que sigue en curso pide volver a preguntar seguido', () => {
    expect(importNoticeBusy(at({})!)).toBe(true);
    expect(importNoticeBusy(at({ status: 'waiting', error: 'not_connected' })!)).toBe(true);
    expect(importNoticeBusy(at({ status: 'failed', finishedAt: '2026-11-19T11:00:00.000Z' })!)).toBe(false);
    expect(importNoticeBusy(at({ status: 'done', finishedAt: '2026-11-19T11:59:00.000Z' })!)).toBe(false);
  });
});
