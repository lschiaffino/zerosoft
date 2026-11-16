/**
 * Inbox guarda su copia de los archivos de WhatsApp y la cola los baja sola:
 * el archivo se pide una vez al servidor de WhatsApp, queda privado y cifrado,
 * y desde ahí se ve aunque la línea se desvincule o el servidor ya no tenga el
 * mensaje. La cola reintenta con esperas, no gasta intentos con la línea
 * desvinculada y no baja dos veces lo mismo. Datos inventados.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, getAccountById } from '@/lib/inbox/core';
import { hasStoredMedia, inboxMedia, readStoredMedia, sweepOrphanMedia } from '@/lib/inbox/media-store';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { uploadsRoot } from '@/lib/uploads';
import { MEDIA_BACKOFF_MS, eagerWorthy, queueMediaJob, runMediaJobs } from '@/lib/wa-media-jobs';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const uniq = () => Math.random().toString(36).slice(2, 10);

async function account(label: string) {
  const u = await makeUser(label);
  const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { u, acc: (await getAccountById(a.id))! };
}

function voice(pid: string, ageMs = 60_000): InboundEvent {
  const chatId = '5491155550123@s.whatsapp.net';
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: '5491155550123',
    senderName: 'Ana Ejemplo',
    providerMessageId: pid,
    body: '',
    media: { url: '', type: 'audio/ogg', name: '', info: { kind: 'voice', ptt: true, duration: 2 }, fetchRef: { providerMessageId: pid, chatId, fromMe: false } },
    timestamp: new Date(Date.now() - ageMs).toISOString(),
  } as InboundEvent;
}

const row = async (pid: string) => (await getDb().prepare('SELECT id, owner_id, media_ref FROM inbox_messages WHERE external_id = ?').get(pid)) as { id: string; owner_id: string; media_ref: string };
const job = async (id: string) => (await getDb().prepare("SELECT attempts, next_at, last_kind FROM wa_media_jobs WHERE app = 'inbox' AND message_id = ?").get(id)) as { attempts: number; next_at: string; last_kind: string } | undefined;
/** Corre la cola "más adelante" (cuando ya toca), solo los trabajos de la cuenta de esta prueba. */
const later = (scopeId: string, ms: number) => runMediaJobs({ limit: 50, scopeId }, Date.now() + ms);

describe('la copia guardada', () => {
  it('se baja una vez, queda cifrada y se sirve aunque la línea se desvincule', async () => {
    const { u, acc } = await account('ms1');
    const pid = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    const msg = await row(pid);
    expect(await hasStoredMedia(u.id, msg.id)).toBe(false);
    const first = await inboxMedia(acc, u.id, msg);
    expect(first.mimetype).toBe('audio/wav');
    expect(await hasStoredMedia(u.id, msg.id)).toBe(true);
    // En disco no queda el audio en claro (la cabecera de un WAV no aparece).
    const dir = path.join(uploadsRoot(), 'inbox-media');
    const ref = String(((await getDb().prepare('SELECT file_ref FROM inbox_media_files WHERE message_id = ?').get(msg.id)) as { file_ref: string }).file_ref);
    expect(ref).toMatch(/^local:/);
    expect(readdirSync(dir)).toContain(ref.slice(6));
    expect(readFileSync(path.join(dir, ref.slice(6))).includes(Buffer.from('RIFF'))).toBe(false);
    // Con la línea desvinculada (sin proveedor) la copia se sigue sirviendo, igual byte a byte.
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected', provider = '' WHERE id = ?").run(acc.id);
    const off = (await getAccountById(acc.id))!;
    const again = await inboxMedia(off, u.id, msg);
    expect(again.data.equals(first.data)).toBe(true);
    // Otra persona no la lee.
    expect(await readStoredMedia('otra-persona', msg.id)).toBeNull();
  });

  it('sin copia y con la línea desvinculada, dice que está desconectada (no que se perdió)', async () => {
    const { u, acc } = await account('ms2');
    const pid = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected', provider = '' WHERE id = ?").run(acc.id);
    await expect(inboxMedia((await getAccountById(acc.id))!, u.id, await row(pid))).rejects.toMatchObject({ code: 'not_connected', status: 409 });
  });

  it('al borrar el mensaje el repaso borra la copia', async () => {
    const { u, acc } = await account('ms3');
    const a = `aud-${uniq()}`;
    const b = `aud-${uniq()}`;
    const keep = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(a), voice(b), voice(keep)]);
    for (const pid of [a, b, keep]) await inboxMedia(acc, u.id, await row(pid));
    const ids = { a: (await row(a)).id, b: (await row(b)).id, keep: (await row(keep)).id };
    await getDb().prepare('DELETE FROM inbox_messages WHERE id IN (?, ?)').run(ids.a, ids.b);
    expect(await sweepOrphanMedia(1000)).toBeGreaterThanOrEqual(2);
    const left = ((await getDb().prepare('SELECT message_id FROM inbox_media_files WHERE owner_id = ?').all(u.id)) as Array<{ message_id: string }>).map((r) => r.message_id);
    expect(left).toEqual([ids.keep]);
    expect(await sweepOrphanMedia(1000)).toBe(0);
  });
});

describe('la copia: casos de borde', () => {
  it('una copia que no se puede leer no se borra; al bajarlo de nuevo, la reemplaza', async () => {
    const { u, acc } = await account('ms4');
    const pid = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    const msg = await row(pid);
    await inboxMedia(acc, u.id, msg);
    const refOf = async () => String(((await getDb().prepare('SELECT file_ref FROM inbox_media_files WHERE message_id = ?').get(msg.id)) as { file_ref: string }).file_ref);
    // La referencia apunta a un archivo que no está (como una lectura que falla).
    await getDb().prepare('UPDATE inbox_media_files SET file_ref = ? WHERE message_id = ?').run('local:00000000-0000-4000-8000-000000000000.bin', msg.id);
    expect(await readStoredMedia(u.id, msg.id)).toBeNull();
    expect(await hasStoredMedia(u.id, msg.id)).toBe(true);
    // Se vuelve a bajar del servidor y la fila pasa a la copia nueva.
    const again = await inboxMedia(acc, u.id, msg);
    expect(again.mimetype).toBe('audio/wav');
    expect(await refOf()).not.toContain('00000000-0000-4000-8000');
    expect((await readStoredMedia(u.id, msg.id))?.data.equals(again.data)).toBe(true);
  });

  it('pasado el tope por persona no se guardan copias nuevas, pero el archivo se sigue viendo', async () => {
    const { u, acc } = await account('ms5');
    const pid = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    const msg = await row(pid);
    vi.stubEnv('INBOX_MEDIA_MAX_MB', '0.00001');
    expect((await inboxMedia(acc, u.id, msg)).data.length).toBeGreaterThan(0);
    expect(await hasStoredMedia(u.id, msg.id)).toBe(false);
  });

  it('guardarlo al abrirlo lo saca de la cola', async () => {
    const { u, acc } = await account('ms6');
    const pid = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    const msg = await row(pid);
    expect(await job(msg.id)).toBeDefined();
    await inboxMedia(acc, u.id, msg);
    expect(await job(msg.id)).toBeUndefined();
  });
});

describe('la cola', () => {
  it('lo que llega queda en la cola y el cron lo baja; lo viejo no se baja solo', async () => {
    const { u, acc } = await account('mq1');
    const fresh = `aud-${uniq()}`;
    const old = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(fresh), voice(old, 90 * 86_400_000)], { history: true });
    const f = await row(fresh);
    const o = await row(old);
    expect(await job(f.id)).toBeDefined();
    expect(await job(o.id)).toBeUndefined();
    expect(eagerWorthy(new Date(Date.now() - 90 * 86_400_000).toISOString())).toBe(false);
    // Todavía no toca (unos segundos de margen para el gateway).
    await runMediaJobs({ limit: 50, scopeId: acc.id });
    expect(await hasStoredMedia(u.id, f.id)).toBe(false);
    await later(acc.id, 10_000);
    expect(await hasStoredMedia(u.id, f.id)).toBe(true);
    expect(await job(f.id)).toBeUndefined();
    // El mismo mensaje otra vez no vuelve a la cola (ya está guardado, y no es nuevo).
    await ingestWhatsappEvents(acc, [voice(fresh)], { history: true });
    expect(await job(f.id)).toBeUndefined();
  });

  it('una falla pasajera se reintenta con esperas cada vez más largas y después baja', async () => {
    const { u, acc } = await account('mq2');
    const pid = `fail2-aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(pid)]);
    const m = await row(pid);
    await later(acc.id, 10_000);
    expect(await job(m.id)).toMatchObject({ attempts: 1, last_kind: 'pending' });
    // Antes de la espera no se vuelve a pedir.
    await later(acc.id, 10_000 + MEDIA_BACKOFF_MS[0] - 5_000);
    expect((await job(m.id))!.attempts).toBe(1);
    await later(acc.id, 10_000 + MEDIA_BACKOFF_MS[0] + 5_000);
    expect((await job(m.id))!.attempts).toBe(2);
    await later(acc.id, 10_000 + MEDIA_BACKOFF_MS[0] + MEDIA_BACKOFF_MS[1] + 20_000);
    expect(await hasStoredMedia(u.id, m.id)).toBe(true);
    expect(await job(m.id)).toBeUndefined();
  });

  it('lo que WhatsApp ya no tiene sale de la cola; con la línea desvinculada espera sin gastar intentos', async () => {
    const { u, acc } = await account('mq3');
    const gone = `gone-aud-${uniq()}`;
    const wait = `aud-${uniq()}`;
    await ingestWhatsappEvents(acc, [voice(gone), voice(wait)]);
    const g = await row(gone);
    const w = await row(wait);
    await getDb().prepare("UPDATE wa_media_jobs SET next_at = ? WHERE message_id = ?").run(new Date(Date.now() + 3_600_000).toISOString(), w.id);
    await later(acc.id, 10_000);
    expect(await job(g.id)).toBeUndefined();
    expect(await hasStoredMedia(u.id, g.id)).toBe(false);
    // La línea se cae: el otro espera, sin intentos gastados.
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(acc.id);
    await later(acc.id, 3_700_000);
    expect(await job(w.id)).toMatchObject({ attempts: 0, last_kind: 'offline' });
    // Vuelve a vincularse: baja.
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(acc.id);
    await later(acc.id, 3 * 3_600_000);
    expect(await hasStoredMedia(u.id, w.id)).toBe(true);
  });

  it('una línea desvinculada con muchos pendientes no tapa a las demás', async () => {
    const off = `acc_${uniq()}`;
    const ok = `acc_${uniq()}`;
    const t0 = Date.now() - 86_400_000;
    // 40 trabajos viejos de una línea y uno más nuevo de otra.
    for (let i = 0; i < 40; i++) await queueMediaJob('inbox', off, `m_${uniq()}`, 0, t0 + i);
    const mine = `m_${uniq()}`;
    await queueMediaJob('inbox', ok, mine, 0, t0 + 1000);
    const ran: string[] = [];
    const r = await runMediaJobs(
      {
        limit: 8,
        run: async (j) => {
          ran.push(j.scope_id);
          return j.scope_id === off ? 'offline' : 'done';
        },
      },
      Date.now(),
    );
    // De la línea caída se prueba uno solo, todos los suyos esperan juntos, y el de la otra línea se baja.
    expect(ran.filter((s) => s === off)).toHaveLength(1);
    expect(ran).toContain(ok);
    expect(r.offline).toBe(1);
    const waiting = (await getDb().prepare("SELECT COUNT(*) AS n FROM wa_media_jobs WHERE scope_id = ? AND next_at > ?").get(off, new Date().toISOString())) as { n: number };
    expect(Number(waiting.n)).toBe(40);
    await getDb().prepare('DELETE FROM wa_media_jobs WHERE scope_id IN (?, ?)').run(off, ok);
  });

  it('un trabajo que corta la corrida una y otra vez se descarta', async () => {
    const scope = `acc_${uniq()}`;
    const id = `m_${uniq()}`;
    await queueMediaJob('inbox', scope, id);
    // El reclamo cuenta como intento aunque la corrida muera antes de anotar el resultado.
    let t = Date.now() + 1000;
    for (let i = 0; i <= MEDIA_BACKOFF_MS.length; i++) {
      await getDb().prepare("UPDATE wa_media_jobs SET attempts = attempts + 1, claimed_until = ? WHERE message_id = ?").run(new Date(t).toISOString(), id);
      t += 4 * 60_000;
    }
    const r = await runMediaJobs({ limit: 50, scopeId: scope, run: async () => 'pending' }, t);
    expect(r.gone).toBe(1);
    expect(await job(id)).toBeUndefined();
  });

  it('dos corridas a la vez no bajan lo mismo, y hay un tope por línea', async () => {
    const scope = `acc_${uniq()}`;
    const ids = Array.from({ length: 5 }, () => `m_${uniq()}`);
    for (const id of ids) await queueMediaJob('inbox', scope, id);
    const seen: string[] = [];
    const run = async (j: { message_id: string }) => {
      seen.push(j.message_id);
      await new Promise((r) => setTimeout(r, 20));
      return 'done' as const;
    };
    const [a, b] = await Promise.all([runMediaJobs({ limit: 50, run, scopeId: scope }, Date.now() + 1000), runMediaJobs({ limit: 50, run, scopeId: scope }, Date.now() + 1000)]);
    // Ninguno dos veces, y como mucho 3 por línea en una corrida (las dos a la vez ven los mismos 3).
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(3);
    expect(a.done + b.done).toBe(3);
    // La corrida siguiente toma los que quedaban.
    const c = await runMediaJobs({ limit: 50, run, scopeId: scope }, Date.now() + 1000);
    expect(c.done).toBe(2);
    expect([...seen].sort()).toEqual([...ids].sort());
  });
});
