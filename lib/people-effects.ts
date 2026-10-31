/**
 * People: lo que sale hacia otras apps. Disparadores de Flow (solo para
 * flows armados por HR con People: los datos de una persona no viajan a la
 * automatización de cualquiera), avisos dentro de la app (sin datos
 * sensibles en el título ni en el cuerpo) y a quién avisar. Nunca tira.
 */
import type { NotificationText } from './notification-copy';
import { getDb } from './db';

export type PeopleEventType = 'people.hired' | 'people.timeoff.approved' | 'people.offboarded';

/** ¿Quien armó el flow es HR de People en el workspace (y tiene la app)? */
export async function isPeopleHr(ws: string, personId: string): Promise<boolean> {
  if (personId === ws) return true;
  const { listOwnerSpacePeople } = await import('./workspace');
  const person = (await listOwnerSpacePeople(ws, { app: 'people' })).find((p) => p.id === personId);
  if (!person) return false;
  if (person.role === 'owner' || person.role === 'admin') return true;
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM people_hr_admins WHERE workspace_id = ? AND user_id = ?').get(ws, personId));
}

export async function emitPeopleEvent(ws: string, type: PeopleEventType, data: Record<string, unknown>): Promise<void> {
  try {
    const { emitEventSoon } = await import('./events');
    await emitEventSoon(ws, type, data, { audience: (creatorId) => isPeopleHr(ws, creatorId ?? ws) });
  } catch (err) {
    console.error('[people] event failed', err instanceof Error ? err.message : 'error');
  }
}

/** Aviso dentro de la app. El título no lleva datos sensibles (ni tipo de licencia ni montos). */
const clip = (text: NotificationText, max: number): NotificationText => (typeof text === 'string' ? text.slice(0, max) : text);

export async function notifyPeople(userIds: Array<string | null | undefined>, n: { title: NotificationText; body?: NotificationText; href: string; sourceId: string }): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  if (!ids.length) return;
  try {
    const { createNotification } = await import('./notifications');
    for (const userId of ids) {
      await createNotification({ userId, type: 'people', title: clip(n.title, 200), body: n.body === undefined ? undefined : clip(n.body, 500), href: n.href, sourceType: 'people', sourceId: n.sourceId });
    }
  } catch (err) {
    console.error('[people] notify failed', err instanceof Error ? err.message : 'error');
  }
}

/** HR del workspace con People (owner, admins y HR admins). */
export async function hrPeople(ws: string): Promise<string[]> {
  try {
    const { listOwnerSpacePeople } = await import('./workspace');
    const people = await listOwnerSpacePeople(ws, { app: 'people' });
    const extra = (await getDb().prepare('SELECT user_id FROM people_hr_admins WHERE workspace_id = ?').all(ws)) as Array<{ user_id: string }>;
    const extraSet = new Set(extra.map((e) => e.user_id));
    return [...new Set([ws, ...people.filter((p) => p.role === 'owner' || p.role === 'admin' || extraSet.has(p.id)).map((p) => p.id)])];
  } catch {
    return [ws];
  }
}
