/**
 * De Hiring a People: al contratar, el ingreso queda cargado como ficha en
 * onboarding, con su puesto, área y fecha de inicio. Solo si el workspace ya usa
 * People (nunca lo enciende solo) y sin sueldo: el monto lo carga HR, con su
 * historial y auditoría. El email del candidato va a los datos personales
 * (cifrados): el de trabajo lo pone HR o llega al aceptar la invitación.
 */
import { getDb } from './db';
import { localized } from './notification-copy';
import { newId, nowIso, sealPersonal } from './people';
import { hrPeople, notifyPeople } from './people-effects';
import type { HireEvent } from './hiring/events';

const TYPES: Record<string, string> = { full_time: 'full_time', part_time: 'part_time', contract: 'contractor', temporary: 'contractor', internship: 'intern' };

export async function addHireToPeople(e: HireEvent): Promise<string | null> {
  const db = getDb();
  if (!(await db.prepare('SELECT 1 AS x FROM people_settings WHERE workspace_id = ?').get(e.workspaceId))) return null;
  if (await db.prepare('SELECT 1 AS x FROM people_employees WHERE workspace_id = ? AND source_application_id = ?').get(e.workspaceId, e.applicationId)) return null;
  const id = newId('emp');
  const now = nowIso();
  // De un puesto confidencial, el directorio no recibe ni el título ni el área ni la ubicación: los pone HR cuando se pueda decir.
  const secret = e.job.confidential === true;
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO people_employees (id, workspace_id, user_id, name, work_email, phone, job_title, department, location, employment_type, status, start_date, personal, source_application_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, '', ?, ?, ?, ?, ?, 'onboarding', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      e.workspaceId,
      e.candidate.name.slice(0, 120),
      e.candidate.phone.slice(0, 200),
      secret ? '' : (e.offer?.title || e.job.title).slice(0, 200),
      secret ? '' : e.job.department.slice(0, 200),
      (secret ? e.candidate.location : e.job.location || e.candidate.location).slice(0, 200),
      TYPES[e.job.employmentType] ?? 'full_time',
      e.offer?.startDate ?? null,
      sealPersonal({ personalEmail: e.candidate.email.slice(0, 200), address: '', nationalId: '', birthDate: '', emergencyContacts: [] }),
      e.applicationId,
      now,
      now,
    );
  if (!res.changes) return null;
  await notifyPeople(await hrPeople(e.workspaceId), { title: localized('peopleHireAdded', { name: e.candidate.name.slice(0, 120) }), body: secret ? undefined : e.job.title.slice(0, 200), href: `/app/people/${id}`, sourceId: id });
  return id;
}

/** Una contratación que se deshace: la ficha sigue en People y HR lo tiene que saber. */
export async function warnHireUndone(ws: string, applicationId: string, name: string): Promise<void> {
  const r = (await getDb().prepare('SELECT id FROM people_employees WHERE workspace_id = ? AND source_application_id = ?').get(ws, applicationId)) as { id: string } | undefined;
  if (!r) return;
  await notifyPeople(await hrPeople(ws), { title: localized('peopleHireUndone', { name: name.slice(0, 120) }), href: `/app/people/${r.id}`, sourceId: r.id });
}
