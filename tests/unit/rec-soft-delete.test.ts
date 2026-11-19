import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import { createVideo, finalizeVideo, getVideoRow, setVideoFile, type RecActor } from '@/lib/rec';
import { applyRetention, getRecSettings, updateRecSettings } from '@/lib/rec-admin';
import { listRecTrash, restoreRecTrash } from '@/lib/rec-trash';
import { assembleLocal, saveLocalPart } from '@/lib/rec-upload';
import { getSoftDeleted, purgeDueSoftDeleted } from '@/lib/soft-delete';
import { localUploadPath } from '@/lib/uploads';

// Hora congelada para la retención: todo se mide contra NOW, nunca contra el reloj.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 86_400_000;
const db = (iso: string) => iso.slice(0, 19).replace('T', ' ');
const ago = (days: number) => db(new Date(NOW.getTime() - days * DAY).toISOString());
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

let uploads = '';
const uid = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), 'rec-sd-'));
  vi.stubEnv('UPLOADS_DIR', uploads);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploads, { recursive: true, force: true });
});

/** Workspace con retención de `days` días, ya pasado el aviso, una admin y una persona más. */
async function setup(days = 90) {
  const ws = `rsd-${uid()}`;
  const owner: RecActor = { ws, actor: ws, admin: true, name: 'Owner' };
  const member: RecActor = { ws, actor: `${ws}-m`, admin: false, name: 'Member' };
  for (const id of [owner.actor, member.actor]) await upsertUser({ id, email: `${id}@test.local`, name: id });
  await updateRecSettings(owner, { retentionDays: days });
  await getDb().prepare("UPDATE rec_settings SET retention_starts_at = ? WHERE workspace_id = ?").run(ago(1), ws);
  return { owner, member };
}

/** Video listo con su archivo, creado `daysAgo` días antes de NOW. */
async function video(actor: RecActor, daysAgo: number, title = `Video ${uid()}`) {
  const v = await createVideo(actor, { title, mode: 'screen', contentType: 'video/webm' });
  await saveLocalPart(v.id, 'video', 1, Buffer.from('first'));
  const out = await assembleLocal(v.id, 'video', 'video/webm', 1);
  await setVideoFile(v.id, 'video', out.url, { size: out.size });
  await finalizeVideo(actor, v.id, { durationSec: 60 });
  await getDb().prepare("UPDATE rec_videos SET transcript_status = 'none', created_at = ? WHERE id = ?").run(ago(daysAgo), v.id);
  return { id: v.id, title, url: out.url };
}

const stored = (url: string) => {
  const p = localUploadPath(url);
  return !!p && existsSync(p);
};
const run = (at = NOW) => applyRetention({ at, limit: 100, budgetMs: 10_000 });
/** Libera el reclamo por hora del workspace, para correr otra vez en el mismo test. */
const unclaim = (ws: string) => getDb().prepare('UPDATE rec_settings SET retention_checked_at = NULL WHERE workspace_id = ?').run(ws);

describe('Rec: la retención manda a la papelera', () => {
  it('saca de la app lo que entra en la gracia, con el archivo guardado, y la purga cae en el plazo de siempre', async () => {
    const { owner } = await setup(90);
    const overdue = await video(owner, 100);
    const inGrace = await video(owner, 70);
    const fresh = await video(owner, 50);

    expect((await run()).deleted).toBe(2);
    expect(await getVideoRow(owner, overdue.id)).toBeNull();
    expect(await getVideoRow(owner, inGrace.id)).toBeNull();
    expect(await getVideoRow(owner, fresh.id)).not.toBeNull();
    expect(stored(inGrace.url)).toBe(true);

    const trash = await listRecTrash(owner);
    const byTitle = Object.fromEntries(trash.map((t) => [t.title, t]));
    expect(Object.keys(byTitle).sort()).toEqual([overdue.title, inGrace.title].sort());
    // Lo vencido se purga en el próximo tick; lo de la gracia, exactamente a los 90 días de creado.
    expect(byTitle[overdue.title].purgeAt).toBe(NOW.toISOString());
    expect(byTitle[inGrace.title].purgeAt).toBe(later(20).toISOString());
    expect((await getRecSettings(owner.ws)).retentionDeleted).toBe(2);
    // Correr otra vez no duplica nada.
    await unclaim(owner.ws);
    expect((await run()).deleted).toBe(0);
  });

  it('el cron purga en el plazo, ni un minuto antes, y borra el archivo', async () => {
    const { owner } = await setup(90);
    const v = await video(owner, 70);
    await run();
    const [entry] = await listRecTrash(owner);
    await purgeDueSoftDeleted(new Date(later(20).getTime() - 60_000));
    expect(await getSoftDeleted(owner.ws, 'rec', entry.id)).not.toBeNull();
    expect(stored(v.url)).toBe(true);
    await purgeDueSoftDeleted(later(20));
    expect(await getSoftDeleted(owner.ws, 'rec', entry.id)).toBeNull();
    expect(stored(v.url)).toBe(false);
  });

  it('restaurar devuelve el video y su archivo, y el plazo cuenta desde ahí', async () => {
    const { owner } = await setup(90);
    const v = await video(owner, 70);
    await run();
    const [entry] = await listRecTrash(owner);
    await restoreRecTrash(owner, entry.id);
    expect(await listRecTrash(owner)).toEqual([]);
    expect(await getVideoRow(owner, v.id)).not.toBeNull();
    expect(stored(v.url)).toBe(true);
    expect((await getRecSettings(owner.ws)).retentionDeleted).toBe(0);
    // retained_at es ahora (reloj real, después de NOW): la corrida siguiente no lo vuelve a sacar.
    await unclaim(owner.ws);
    expect((await run()).deleted).toBe(0);
    expect(await getVideoRow(owner, v.id)).not.toBeNull();
    await expect(restoreRecTrash(owner, entry.id)).rejects.toMatchObject({ status: 404 });
  });

  it('cada persona ve y restaura los suyos; un admin, todos; otro workspace, nada', async () => {
    const { owner, member } = await setup(90);
    const mine = await video(member, 70);
    const theirs = await video(owner, 70);
    await run();
    const all = await listRecTrash(owner);
    expect(all.map((t) => t.title).sort()).toEqual([mine.title, theirs.title].sort());
    const own = await listRecTrash(member);
    expect(own.map((t) => t.title)).toEqual([mine.title]);
    expect(own[0].ownerId).toBe(member.actor);
    const ownersEntry = all.find((t) => t.title === theirs.title)!;
    await expect(restoreRecTrash(member, ownersEntry.id)).rejects.toMatchObject({ status: 404 });
    const other = await setup(90);
    expect(await listRecTrash(other.owner)).toEqual([]);
    await expect(restoreRecTrash(other.owner, own[0].id)).rejects.toMatchObject({ status: 404 });
    await restoreRecTrash(member, own[0].id);
    expect(await getVideoRow(member, mine.id)).not.toBeNull();
  });

  it('avisa a quien lo grabó cuando pasa a la papelera', async () => {
    const { owner, member } = await setup(90);
    await video(member, 70);
    await run();
    const n = (await getDb().prepare("SELECT href FROM notifications WHERE user_id = ? AND type = 'rec_retention'").all(member.actor)) as Array<{ href: string }>;
    expect(n.map((r) => r.href)).toEqual(['/app/rec/settings']);
    expect(owner.admin).toBe(true);
  });

  it('dos corridas a la vez lo mandan una sola vez', async () => {
    const { owner } = await setup(90);
    const v = await video(owner, 70);
    await Promise.all([run(), run()]);
    const rows = await getDb().prepare("SELECT 1 FROM soft_deleted WHERE app = 'rec' AND record_id = ?").all(v.id);
    expect(rows).toHaveLength(1);
  });

  it('con un plazo corto la gracia es un tercio: 30 días de plazo, 10 de papelera', async () => {
    const { owner } = await setup(30);
    const out = await video(owner, 25);
    const kept = await video(owner, 15);
    await run();
    expect(await getVideoRow(owner, out.id)).toBeNull();
    expect(await getVideoRow(owner, kept.id)).not.toBeNull();
    const [entry] = await listRecTrash(owner);
    expect(entry.purgeAt).toBe(later(5).toISOString());
  });
});
