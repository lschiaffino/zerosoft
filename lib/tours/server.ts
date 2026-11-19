/**
 * Estado de los tours por persona (users.profile.tours, ver lib/tours) y lo
 * que arranca el tour de una app. Se guarda en el perfil de la persona real
 * (no en el del owner del workspace): los tours son de quien los mira.
 *
 * Server-only.
 */
import { getDb } from '@/lib/db';
import { getProfile, patchProfile } from '@/lib/onboarding';
import { isWorkspaceAdmin, realUserId, type SessionUser } from '@/lib/session';
import { deduceAudience, parseTours, shouldAutoStart, type TourAudience, type TourBoot, type TourKey, type TourStatus, type ToursProfile } from './index';

export async function getTours(userId: string): Promise<ToursProfile> {
  const profile = (await getProfile(userId)) as { tours?: unknown };
  return parseTours(profile.tours);
}

/** Gente en el workspace (además del owner) o invitaciones pendientes: es un equipo. */
async function workspaceShape(ownerId: string): Promise<{ people: number; useMode: string | null }> {
  const db = getDb();
  try {
    const row = (await db
      .prepare(
        `SELECT
           (SELECT use_mode FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC LIMIT 1) AS use_mode,
           (SELECT COUNT(DISTINCT m.user_id) FROM team_members m JOIN teams t ON t.id = m.team_id
             WHERE t.owner_id = ? AND m.user_id != ? AND m.role != 'guest') AS members,
           (SELECT COUNT(*) FROM team_invites i JOIN teams t ON t.id = i.team_id
             WHERE t.owner_id = ? AND i.status = 'pending' AND COALESCE(i.kind, 'invite') = 'invite') AS invites`,
      )
      .get(ownerId, ownerId, ownerId, ownerId)) as { use_mode: string | null; members: number; invites: number } | undefined;
    return { people: 1 + Number(row?.members ?? 0) + Number(row?.invites ?? 0), useMode: row?.use_mode ?? null };
  } catch {
    // Self-host viejo sin alguna tabla: no se deduce, se pregunta.
    return { people: 1, useMode: null };
  }
}

/** Lo que el cliente necesita para el tour `tour` (lo arma el layout de la app). */
export async function tourBoot(user: SessionUser, tour: TourKey): Promise<TourBoot> {
  const real = user.actingUser ?? user;
  const [profile, shape] = await Promise.all([getProfile(realUserId(user)), workspaceShape(user.id)]);
  const tours = parseTours((profile as { tours?: unknown }).tours);
  const progress = tours.seen?.[tour];
  return {
    tour,
    auto: shouldAutoStart({ onboarded: Boolean(real.onboarded_at), profileVersion: profile.v ?? 0, tours, tour }),
    resume: progress?.status === 'active' ? (progress.step ?? null) : null,
    audience: deduceAudience({ acting: Boolean(user.actingUser), people: shape.people, useMode: shape.useMode, answer: tours.audience }),
    admin: isWorkspaceAdmin(user),
    off: Boolean(tours.off),
  };
}

/** Progreso de un tour: paso actual, terminado o cerrado. */
export async function saveTourProgress(userId: string, tour: TourKey, status: TourStatus, step?: string | null): Promise<void> {
  await patchProfile(userId, { tours: { seen: { [tour]: { status, step: step ?? null, at: new Date().toISOString() } } } });
}

/** "No mostrar más tours" (o volver a mostrarlos). */
export async function setToursOff(userId: string, off: boolean): Promise<void> {
  await patchProfile(userId, { tours: { off: off ? true : null } });
}

/** Respuesta a "¿sola o con tu equipo?". */
export async function setTourAudience(userId: string, audience: TourAudience): Promise<void> {
  await patchProfile(userId, { tours: { audience } });
}

/** Volver a ver todos los tours desde el principio (Ajustes › Apariencia). */
export async function resetTours(userId: string): Promise<void> {
  await patchProfile(userId, { tours: { off: null, seen: null } });
}
