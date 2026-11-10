/**
 * Páginas de Analytics: la sesión como BiViewer (las páginas viven bajo el
 * layout de la app, que ya bloquea a quien no tiene la app).
 */
import { notFound } from 'next/navigation';
import { requireUser } from '../session';
import { isBiAdmin, viewerCan, type BiViewer } from './access';

export async function biPage(locale: string): Promise<{ viewer: BiViewer; isAdmin: boolean }> {
  const user = await requireUser(locale);
  const viewer: BiViewer = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role, apps: user.apps ?? '*' };
  if (user.role === 'guest' || !viewerCan(viewer, 'analytics')) notFound();
  return { viewer, isAdmin: isBiAdmin(viewer) };
}
