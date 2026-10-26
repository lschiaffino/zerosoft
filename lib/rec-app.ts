/**
 * Rec: datos para las páginas de la app (biblioteca y detalle). Server-only.
 */
import { requireUser } from './session';
import { actorOf } from './rec-http';
import { getFolder, listFolders, listVideos, type RecScope } from './rec';
import { recBaseUrl } from './rec-page';

export async function libraryData(locale: string, scope: RecScope) {
  const user = await requireUser(locale);
  const actor = actorOf(user);
  const folder = scope.kind === 'folder' ? await getFolder(actor, scope.folderId) : null;
  if (scope.kind === 'folder' && !folder) return null;
  const [videos, folders] = await Promise.all([listVideos(actor, scope), listFolders(actor)]);
  return { actor, videos, folders, folder, baseUrl: recBaseUrl() };
}
