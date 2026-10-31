/**
 * Rec: datos para las páginas de la app (biblioteca y detalle). Server-only.
 */
import { requireUser } from './session';
import { actorOf } from './rec-http';
import { getFolder, listFolders, listVideos, type RecScope } from './rec';
import { getSpace, listSpaces } from './rec-admin';
import { recBaseUrl } from './rec-page';

export async function libraryData(locale: string, scope: RecScope) {
  const user = await requireUser(locale);
  const actor = actorOf(user);
  const folder = scope.kind === 'folder' ? await getFolder(actor, scope.folderId) : null;
  if (scope.kind === 'folder' && !folder) return null;
  const space = scope.kind === 'space' ? await getSpace(actor, scope.spaceId) : null;
  if (scope.kind === 'space' && !space) return null;
  const [videos, folders, spaces] = await Promise.all([listVideos(actor, scope), listFolders(actor), listSpaces(actor)]);
  return { actor, videos, folders, folder, space, spaces, baseUrl: recBaseUrl() };
}
