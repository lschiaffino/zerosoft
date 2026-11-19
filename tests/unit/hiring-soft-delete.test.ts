import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { ensureWorkspace } from '@/lib/workspace';
import { createJob, ensureSettings, updateJob, updateSettings } from '@/lib/hiring/core';
import { addNote, applyPublic, forgetByToken, getCandidateProfile, purgeExpiredCandidates, retentionDeadline, sha256 } from '@/lib/hiring/candidates';
import { listHiringTrash, restoreHiringTrash } from '@/lib/hiring/trash';
import { readHiringFile } from '@/lib/hiring/files';
import { getSoftDeleted, purgeDueSoftDeleted } from '@/lib/soft-delete';
import type { HiringActor } from '@/lib/hiring/types';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-hiring-sd-uploads-${process.pid}`);
process.env.RATE_LIMIT_DISABLED = 'true';

// Hora congelada: todo se mide contra NOW, nunca contra el reloj.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const uid = () => Math.random().toString(36).slice(2, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

interface Setup {
  owner: HiringActor;
  member: HiringActor;
  handle: string;
  slug: string;
}

/** Workspace con retención de 6 meses, un puesto publicado y una persona sin rol de admin. */
async function setup(retentionMonths = 6): Promise<Setup> {
  const o = await upsertUser({ email: `hr-sd-${uid()}@example.com`, name: 'Owner', image: null });
  const team = await ensureWorkspace(o.id);
  const owner = { ws: o.id, person: o.id, admin: true };
  const settings = await ensureSettings(o.id);
  await updateSettings(owner, { published: true, retentionMonths });
  const m = await upsertUser({ email: `hr-sd-m-${uid()}@example.com`, name: 'Member', image: null });
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(team.id, m.id, 'member', '["hiring"]');
  const job = await createJob(owner, { title: `Engineer ${uid()}`, description: 'x' });
  await updateJob(owner, job.job.id, { status: 'published' });
  return { owner, member: { ws: o.id, person: m.id, admin: false }, handle: settings.handle, slug: job.job.slug };
}

/** Postulación con CV y una nota; la última actividad queda en `lastActivity`. */
async function candidate(s: Setup, lastActivity: string, email = `c-${uid()}@example.com`) {
  const res = await applyPublic(s.handle, s.slug, { name: `Ana ${uid()}`, email, phone: '', linkedin: '', answers: {}, consent: true, keepConsent: false, utm: {}, referrer: '', source: null }, { bytes: PDF, filename: 'cv.pdf' });
  await addNote(s.owner, res.applicationId, 'Good call');
  const db = getDb();
  const row = (await db.prepare('SELECT c.id, c.name, c.resume_url FROM hiring_candidates c JOIN hiring_applications a ON a.candidate_id = c.id WHERE a.id = ?').get(res.applicationId)) as { id: string; name: string; resume_url: string };
  await db.prepare('UPDATE hiring_candidates SET last_activity_at = ? WHERE id = ?').run(lastActivity, row.id);
  return { ...row, applicationId: res.applicationId };
}

const exists = async (id: string) => !!(await getDb().prepare('SELECT 1 FROM hiring_candidates WHERE id = ?').get(id));

describe('Hiring: la retención manda a la papelera', () => {
  it('el plazo de siempre: meses de calendario, fin de mes incluido', () => {
    expect(retentionDeadline('2025-12-15T12:00:00.000Z', 6, NOW).toISOString()).toBe('2026-06-15T12:00:00.000Z');
    // Lo ya vencido se purga en el próximo tick, nunca antes de ahora.
    expect(retentionDeadline('2025-10-01T00:00:00.000Z', 6, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('saca de la app lo que entra en la gracia y la purga cae en el plazo de siempre', async () => {
    const s = await setup();
    const overdue = await candidate(s, '2025-11-01T12:00:00.000Z');
    const inGrace = await candidate(s, '2025-12-15T12:00:00.000Z');
    const fresh = await candidate(s, '2026-02-01T12:00:00.000Z');

    const res = await purgeExpiredCandidates(NOW, 500);
    expect(res.purged).toBeGreaterThanOrEqual(2);
    expect(await exists(overdue.id)).toBe(false);
    expect(await exists(inGrace.id)).toBe(false);
    expect(await exists(fresh.id)).toBe(true);
    // Sus postulaciones y eventos salen con él; el CV queda hasta la purga.
    expect(await getDb().prepare('SELECT 1 FROM hiring_applications WHERE candidate_id = ?').get(inGrace.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 FROM hiring_events WHERE candidate_id = ?').get(inGrace.id)).toBeUndefined();
    expect(await readHiringFile(inGrace.resume_url)).not.toBeNull();

    const trash = await listHiringTrash(s.owner);
    const byName = Object.fromEntries(trash.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([overdue.name, inGrace.name].sort());
    expect(byName[overdue.name].purgeAt).toBe(NOW.toISOString());
    expect(byName[inGrace.name].purgeAt).toBe('2026-06-15T12:00:00.000Z');
    // Correr otra vez no duplica nada.
    await purgeExpiredCandidates(NOW, 500);
    expect(await listHiringTrash(s.owner)).toHaveLength(2);
  });

  it('el cron purga en el plazo, ni un tick antes, y borra el CV', async () => {
    const s = await setup();
    const c = await candidate(s, '2025-12-15T12:00:00.000Z');
    await purgeExpiredCandidates(NOW, 500);
    const [entry] = await listHiringTrash(s.owner);
    const due = at(entry.purgeAt);
    await purgeDueSoftDeleted(new Date(due.getTime() - 60_000));
    expect(await getSoftDeleted(s.owner.ws, 'hiring', entry.id)).not.toBeNull();
    expect(await readHiringFile(c.resume_url)).not.toBeNull();
    await purgeDueSoftDeleted(due);
    expect(await getSoftDeleted(s.owner.ws, 'hiring', entry.id)).toBeNull();
    expect(await readHiringFile(c.resume_url)).toBeNull();
  });

  it('restaurar devuelve candidato, postulación, nota y CV, y la retención cuenta desde ahí', async () => {
    const s = await setup();
    const c = await candidate(s, '2025-12-15T12:00:00.000Z');
    await purgeExpiredCandidates(NOW, 500);
    const [entry] = await listHiringTrash(s.owner);
    await restoreHiringTrash(s.owner, entry.id);
    expect(await listHiringTrash(s.owner)).toEqual([]);
    const profile = await getCandidateProfile(s.owner, c.id);
    expect(profile?.applications.map((a) => a.id)).toEqual([c.applicationId]);
    const kinds = profile!.timeline.map((e) => e.kind);
    expect(kinds).toContain('note');
    expect(kinds).toContain('restored');
    expect(await readHiringFile(c.resume_url)).not.toBeNull();
    // last_activity_at es ahora: el cron siguiente no lo vuelve a sacar.
    await purgeExpiredCandidates(NOW, 500);
    expect(await exists(c.id)).toBe(true);
    // Una entrada que ya no está: 404.
    await expect(restoreHiringTrash(s.owner, entry.id)).rejects.toMatchObject({ status: 404 });
  });

  it('solo un admin ve y restaura; otro workspace no ve nada', async () => {
    const s = await setup();
    await candidate(s, '2025-12-15T12:00:00.000Z');
    await purgeExpiredCandidates(NOW, 500);
    const [entry] = await listHiringTrash(s.owner);
    await expect(listHiringTrash(s.member)).rejects.toMatchObject({ status: 403 });
    await expect(restoreHiringTrash(s.member, entry.id)).rejects.toMatchObject({ status: 403 });
    const other = await setup();
    expect(await listHiringTrash(other.owner)).toEqual([]);
    await expect(restoreHiringTrash(other.owner, entry.id)).rejects.toMatchObject({ status: 404 });
    expect(await getSoftDeleted(s.owner.ws, 'hiring', entry.id)).not.toBeNull();
  });

  it('dos corridas a la vez lo mandan una sola vez', async () => {
    const s = await setup();
    const c = await candidate(s, '2025-12-15T12:00:00.000Z');
    await Promise.all([purgeExpiredCandidates(NOW, 500), purgeExpiredCandidates(NOW, 500)]);
    const rows = await getDb().prepare("SELECT 1 FROM soft_deleted WHERE app = 'hiring' AND record_id = ?").all(c.id);
    expect(rows).toHaveLength(1);
  });

  it('el link para olvidarme purga ya lo que está en la papelera, aunque el candidato esté ahí', async () => {
    const s = await setup();
    const email = `forget-${uid()}@example.com`;
    const c = await candidate(s, '2025-12-15T12:00:00.000Z', email);
    const token = `forget-${uid()}`.padEnd(32, 'y');
    await getDb().prepare('UPDATE hiring_candidates SET forget_token_hash = ? WHERE id = ?').run(sha256(token), c.id);
    await purgeExpiredCandidates(NOW, 500);
    const [entry] = await listHiringTrash(s.owner);
    expect(await forgetByToken(token)).toBe(true);
    expect(await getSoftDeleted(s.owner.ws, 'hiring', entry.id)).toBeNull();
    expect(await readHiringFile(c.resume_url)).toBeNull();
    expect(await forgetByToken(token)).toBe(false);
  });

  it('lo que está a más de 30 días del plazo no entra', async () => {
    const s = await setup(6);
    // 6 meses ≈ 182 días: gracia de 30. Con 40 días antes del plazo no entra todavía.
    const c = await candidate(s, new Date(NOW.getTime() - (182 - 40) * DAY).toISOString());
    await purgeExpiredCandidates(NOW, 500);
    expect(await exists(c.id)).toBe(true);
  });
});
