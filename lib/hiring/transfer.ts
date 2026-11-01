/**
 * Hiring: importar candidatos de un CSV, copiar o mover una postulación a otro
 * puesto, fusionar dos registros de la misma persona y exportar lo visible.
 * Todo exige gestionar los puestos involucrados: ninguna de estas acciones
 * sirve para ver a un candidato que la persona no ve. Server-only.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { parseCsv, toCsv } from '../hr-csv';
import { deleteApplicationRows, nowIso, parseJson, requireManage, type JobRow } from './core';
import { addCandidateManually, createApplication, getApplicationRow, getCandidateRow, listApplications, requireManageApp, type ListFilter } from './candidates';
import { addEvent } from './events';
import { HiringError, MAX_TAGS, SOURCES, type HiringActor, type Source } from './types';

// ---------- CSV ----------

const HEADERS: Record<string, string> = {
  name: 'name', nombre: 'name', nome: 'name', 'full name': 'name',
  email: 'email', 'e-mail': 'email', correo: 'email',
  phone: 'phone', telefono: 'phone', 'teléfono': 'phone', telefone: 'phone',
  location: 'location', ubicacion: 'location', 'ubicación': 'location', cidade: 'location',
  headline: 'headline', titulo: 'headline', 'título': 'headline',
  source: 'source', fuente: 'source', origem: 'source',
  tags: 'tags', etiquetas: 'tags',
};

export const MAX_IMPORT_ROWS = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportRow {
  line: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  source: Source;
  tags: string[];
  error: string | null;
}

/** Filas del CSV con su error, si lo tienen. Sin efectos: sirve para la vista previa y para los tests. */
export function readCandidateCsv(text: string): { rows: ImportRow[]; missing: string[] } {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], missing: ['name', 'email'] };
  const cols = all[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? '');
  const missing = ['name', 'email'].filter((c) => !cols.includes(c));
  if (missing.length) return { rows: [], missing };
  const seen = new Set<string>();
  const rows = all.slice(1, MAX_IMPORT_ROWS + 1).map((cells, i): ImportRow => {
    const get = (k: string) => (cells[cols.indexOf(k)] ?? '').trim();
    const email = get('email').toLowerCase();
    const src = get('source').toLowerCase();
    const name = get('name').slice(0, 160);
    let error: string | null = null;
    if (!name) error = 'name_required';
    else if (!EMAIL.test(email) || email.length > 254) error = 'invalid_email';
    else if (seen.has(email)) error = 'duplicate_in_file';
    seen.add(email);
    return {
      line: i + 2,
      name,
      email,
      phone: get('phone').slice(0, 40),
      location: get('location').slice(0, 120),
      headline: get('headline').slice(0, 200),
      source: (SOURCES as readonly string[]).includes(src) ? (src as Source) : 'manual',
      tags: get('tags').split(/[|,]/).map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, MAX_TAGS),
      error,
    };
  });
  return { rows, missing: [] };
}

export const importSchema = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(false) });

/** Importa a un puesto. No manda emails a nadie: no aceptaron nada, solo se cargan. */
export async function importCandidates(actor: HiringActor, jobId: string, input: z.infer<typeof importSchema>) {
  await requireManage(actor, jobId);
  const { rows, missing } = readCandidateCsv(input.csv);
  if (missing.length) throw new HiringError('csv_columns', 400, { missing });
  if (!rows.length) throw new HiringError('csv_empty');
  const failed = rows.filter((r) => r.error).map((r) => ({ line: r.line, code: r.error as string }));
  const good = rows.filter((r) => !r.error);
  if (input.dryRun) return { dryRun: true, valid: good.length, failed, preview: good.slice(0, 5).map((r) => ({ name: r.name, email: r.email, source: r.source })) };
  let added = 0;
  let existing = 0;
  for (const r of good) {
    const res = await addCandidateManually(actor, { jobId, name: r.name, email: r.email, phone: r.phone, location: r.location, headline: r.headline, source: r.source, tags: r.tags }, null);
    if (res.existing) existing++;
    else added++;
  }
  return { dryRun: false, valid: good.length, added, existing, failed };
}

// ---------- Copiar o mover a otro puesto ----------

export const copySchema = z.object({ jobId: z.string().min(1).max(80), move: z.boolean().default(false) });

/** Hace falta gestionar los dos puestos. Mover deja la postulación original como retirada. */
export async function copyToJob(actor: HiringActor, appId: string, input: z.infer<typeof copySchema>): Promise<{ applicationId: string; candidateId: string; existing: boolean }> {
  const { app, job, candidate } = await requireManageApp(actor, appId);
  if (input.jobId === job.id) throw new HiringError('same_job');
  const target: JobRow = await requireManage(actor, input.jobId);
  const res = await createApplication(actor.ws, { job: target, candidate, source: 'manual', utm: {}, referrer: '', answers: {}, knockouts: [], createdBy: actor.person });
  if (input.move && app.status === 'active') {
    const ts = nowIso();
    await getDb().prepare("UPDATE hiring_applications SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(ts, app.id);
    await addEvent(actor.ws, candidate.id, app.id, 'stage', actor.person, { movedTo: target.title });
  }
  return { applicationId: res.app.id, candidateId: candidate.id, existing: res.existing };
}

// ---------- Fusionar ----------

export const mergeSchema = z.object({ dropId: z.string().min(1).max(80) });

async function manageAllApps(actor: HiringActor, candidateId: string): Promise<boolean> {
  const apps = (await getDb().prepare('SELECT id FROM hiring_applications WHERE candidate_id = ?').all(candidateId)) as Array<{ id: string }>;
  for (const a of apps) {
    try {
      await requireManageApp(actor, a.id);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Pasa todo de `dropId` a `keepId`: postulaciones, eventos, documentos y tags.
 * Hay que gestionar todas las postulaciones de los dos; si no, un equipo vería
 * datos de otro puesto. Si los dos están en el mismo puesto queda la más vieja.
 */
export async function mergeCandidates(actor: HiringActor, keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) throw new HiringError('same_candidate');
  const [keep, drop] = await Promise.all([getCandidateRow(actor.ws, keepId), getCandidateRow(actor.ws, dropId)]);
  if (!keep || !drop) throw new HiringError('not_found', 404);
  if (!(await manageAllApps(actor, keepId)) || !(await manageAllApps(actor, dropId))) throw new HiringError('forbidden', 403);
  const db = getDb();
  const ts = nowIso();
  const keepJobs = new Set(((await db.prepare('SELECT job_id FROM hiring_applications WHERE candidate_id = ?').all(keepId)) as Array<{ job_id: string }>).map((r) => r.job_id));
  const apps = (await db.prepare('SELECT id, job_id FROM hiring_applications WHERE candidate_id = ?').all(dropId)) as Array<{ id: string; job_id: string }>;
  for (const a of apps) {
    if (keepJobs.has(a.job_id)) await deleteApplicationRows(a.id);
    else await db.prepare('UPDATE hiring_applications SET candidate_id = ?, updated_at = ? WHERE id = ?').run(keepId, ts, a.id);
  }
  await db.prepare('UPDATE hiring_events SET candidate_id = ? WHERE candidate_id = ?').run(keepId, dropId);
  await db.prepare('UPDATE hiring_documents SET candidate_id = ? WHERE candidate_id = ?').run(keepId, dropId);
  const tags = [...new Set([...parseJson<string[]>(keep.tags, []), ...parseJson<string[]>(drop.tags, [])])].slice(0, MAX_TAGS);
  await db
    .prepare(
      `UPDATE hiring_candidates SET tags = ?, phone = CASE WHEN phone = '' THEN ? ELSE phone END, location = CASE WHEN location = '' THEN ? ELSE location END,
        headline = CASE WHEN headline = '' THEN ? ELSE headline END, last_activity_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(tags), drop.phone, drop.location, drop.headline, ts, ts, keepId);
  // El CV del registro que se va pasa a ser un documento más (o el CV, si no había).
  if (drop.resume_url) {
    if (keep.resume_url) {
      await db
        .prepare('INSERT INTO hiring_documents (id, candidate_id, application_id, ref, name, mime, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)')
        .run(`hdo_${dropId}`.slice(0, 60), keepId, drop.resume_url, drop.resume_name ?? 'resume', drop.resume_mime ?? 'application/octet-stream', ts);
    } else {
      await db.prepare('UPDATE hiring_candidates SET resume_url = ?, resume_name = ?, resume_mime = ?, resume_text = ? WHERE id = ?').run(drop.resume_url, drop.resume_name, drop.resume_mime, drop.resume_text, keepId);
    }
  }
  await db.prepare('DELETE FROM hiring_candidates WHERE id = ? AND workspace_id = ?').run(dropId, actor.ws);
  await addEvent(actor.ws, keepId, null, 'note', actor.person, { body: `Merged with ${drop.name} <${drop.email}>`, merged: true });
}

// ---------- Exportar ----------

export async function applicationsCsv(actor: HiringActor, f: ListFilter): Promise<string> {
  const list = await listApplications(actor, { ...f, limit: 5000 });
  return toCsv([
    ['name', 'email', 'job', 'stage', 'status', 'source', 'tags', 'applied_at', 'knocked_out', 'reject_reason'],
    ...(await Promise.all(
      list.map(async (a) => {
        const row = await getApplicationRow(actor.ws, a.id);
        return [a.name, a.email, a.jobTitle, a.stageName, a.status, a.source, a.tags.join('|'), row?.created_at ?? '', a.knockedOut ? 'yes' : 'no', row?.reject_reason ?? ''];
      }),
    )),
  ]);
}
