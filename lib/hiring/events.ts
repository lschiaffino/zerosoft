/**
 * Hiring: línea de tiempo del candidato, avisos al equipo, eventos de Flow y
 * el gancho "al contratar" (para People u otra app). Server-only.
 */
import { getDb } from '../db';
import { createNotification } from '../notifications';
import { emitEventSoon } from '../events';
import { personAppAccess } from '../api-auth';
import { newId, nowIso, parseJson } from './core';

export type EventKind =
  | 'applied'
  | 'reapplied'
  | 'stage'
  | 'note'
  | 'email_out'
  | 'email_in'
  | 'score'
  | 'interview'
  | 'offer'
  | 'tag'
  | 'rejected'
  | 'reactivated'
  | 'hired'
  | 'ai';

export async function addEvent(
  ws: string,
  candidateId: string,
  applicationId: string | null,
  kind: EventKind,
  actorId: string | null,
  data: Record<string, unknown> = {},
): Promise<string> {
  const id = newId('hev');
  const ts = nowIso();
  const db = getDb();
  await db
    .prepare('INSERT INTO hiring_events (id, workspace_id, candidate_id, application_id, kind, actor_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, candidateId, applicationId, kind, actorId, JSON.stringify(data), ts);
  await db.prepare('UPDATE hiring_candidates SET last_activity_at = ? WHERE id = ?').run(ts, candidateId);
  return id;
}

export interface EventRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  kind: EventKind;
  actor_id: string | null;
  data: string;
  created_at: string;
  actor_name?: string | null;
}

export function eventDto(e: EventRow) {
  return { id: e.id, applicationId: e.application_id, kind: e.kind, actorId: e.actor_id, actorName: e.actor_name ?? null, data: parseJson<Record<string, unknown>>(e.data, {}), createdAt: e.created_at };
}
export type EventDto = ReturnType<typeof eventDto>;

/** Equipo de un puesto con un rol (sin la persona que actuó). */
export async function teamIds(jobId: string, roles: string[], except?: string | null): Promise<string[]> {
  const rows = (await getDb()
    .prepare(`SELECT user_id FROM hiring_job_members WHERE job_id = ? AND role IN (${roles.map(() => '?').join(',')})`)
    .all(jobId, ...roles)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id).filter((id) => id !== except);
}

/** Aviso in-app. Solo a personas del equipo del puesto: el texto lleva datos del candidato. */
export async function notifyTeam(userIds: string[], payload: { title: string; body?: string; href: string; sourceId: string }): Promise<void> {
  for (const userId of new Set(userIds)) {
    await createNotification({ userId, type: 'hiring_activity', title: payload.title.slice(0, 200), body: payload.body?.slice(0, 300), href: payload.href, sourceType: 'hiring', sourceId: payload.sourceId }).catch(() => null);
  }
}

/**
 * Flow: solo los flows creados por quien puede ver al candidato (admins y
 * recruiter o hiring manager del puesto). Los webhooks no reciben estos
 * eventos: llevan datos personales.
 */
export function emitHiring(ws: string, type: 'hiring.candidate.applied' | 'hiring.candidate.stage_changed' | 'hiring.candidate.hired', jobId: string, data: Record<string, unknown>): Promise<void> {
  return emitEventSoon(ws, type, data, {
    audience: async (creatorId) => {
      if (!creatorId) return false;
      const access = await personAppAccess(ws, creatorId);
      if (!access) return false;
      if (access.role === 'owner' || access.role === 'admin') return true;
      const row = (await getDb().prepare("SELECT 1 AS one FROM hiring_job_members WHERE job_id = ? AND user_id = ? AND role IN ('recruiter','hiring_manager')").get(jobId, creatorId)) as
        | { one: number }
        | undefined;
      return Boolean(row);
    },
  }).catch(() => undefined);
}

// ---------- Gancho al contratar ----------

/**
 * Lo que recibe quien se suscribe a las contrataciones (People, cuando esté:
 * crear el empleado con su puesto y fecha de inicio). Solo datos del
 * candidato contratado, en el servidor; nunca sale a un webhook.
 */
export interface HireEvent {
  workspaceId: string;
  applicationId: string;
  hiredAt: string;
  hiredBy: string | null;
  candidate: { id: string; name: string; email: string; phone: string; location: string };
  job: { id: string; title: string; department: string; location: string; workplace: string; employmentType: string };
  offer: { title: string; salary: number | null; currency: string; startDate: string | null } | null;
}

export type OnHireHandler = (event: HireEvent) => Promise<void> | void;

const onHireHandlers = new Set<OnHireHandler>();

/** Registra un callback para cada contratación. Devuelve cómo darlo de baja. */
export function registerOnHire(handler: OnHireHandler): () => void {
  onHireHandlers.add(handler);
  return () => onHireHandlers.delete(handler);
}

/** Corre los callbacks (uno que falla no corta a los demás ni a la contratación). */
export async function runOnHire(event: HireEvent): Promise<void> {
  for (const h of onHireHandlers) {
    try {
      await h(event);
    } catch (err) {
      console.error('[hiring] onHire handler', err instanceof Error ? err.message : 'error');
    }
  }
}
