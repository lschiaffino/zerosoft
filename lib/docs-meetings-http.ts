import { canWriteAccess } from './docs-access';
/**
 * Rutas de notas de reunión: la reunión y el acceso de quien llama a su
 * página (ver para leer, editar para grabar, resumir y mandar tareas).
 */
import { getCurrentUser, type SessionUser } from './session';
import { getDocAccess } from './docs';
import { getMeetingRow } from './docs-meetings';
import { forbidden, notFound, unauthorized } from './docs-http';
import type { NextResponse } from 'next/server';

export async function meetingFor(
  id: string,
  write: boolean,
): Promise<{ res: NextResponse } | { user: SessionUser; meeting: NonNullable<Awaited<ReturnType<typeof getMeetingRow>>> }> {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() };
  const meeting = await getMeetingRow(id);
  const access = meeting ? await getDocAccess(meeting.page, user, { includePublished: false, includePublicLink: false }) : null;
  if (!meeting || !access) return { res: notFound() };
  if (write && !canWriteAccess(access)) return { res: forbidden() };
  return { user, meeting };
}
