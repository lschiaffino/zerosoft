/**
 * Rec: estado de la página pública de un video (/v/<id>) para el render del
 * servidor. Server-only.
 */
import { cookies } from 'next/headers';
import { getDb } from './db';
import { getCurrentUser } from './session';
import { getPublicVideoRow, publicAccess, toPublicDto, unlockCookieName, type PublicAccess, type PublicVideoDto } from './rec';
import { publicViewerFor } from './rec-http';
import { getRecBrand, type RecBrand } from './rec-admin';

export function recBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function recShareUrl(locale: string, shareId: string): string {
  return `${recBaseUrl()}/${locale}/v/${shareId}`;
}

export async function resolvePublicPage(
  shareId: string,
): Promise<
  | { state: 'not_found' }
  | { state: Exclude<PublicAccess, 'ok'>; title: string; signedIn: boolean; requestStatus: string | null }
  | { state: 'ok'; video: PublicVideoDto; member: boolean; brand: RecBrand | null }
> {
  const v = await getPublicVideoRow(shareId);
  if (!v) return { state: 'not_found' };
  const user = await getCurrentUser();
  const jar = await cookies();
  const viewer = await publicViewerFor(v, user, (n) => jar.get(n)?.value);
  const access = publicAccess(v, viewer, jar.get(unlockCookieName(v.share_id))?.value ?? null);
  // El título no se muestra si hay contraseña o es solo del workspace.
  if (access !== 'ok') {
    let requestStatus: string | null = null;
    if (access === 'forbidden' && viewer.email) {
      const row = (await getDb().prepare('SELECT status FROM rec_access_requests WHERE video_id = ? AND email = ?').get(v.id, viewer.email.trim().toLowerCase())) as { status: string } | undefined;
      requestStatus = row?.status ?? null;
    }
    return { state: access, title: access === 'expired' ? v.title : '', signedIn: !!viewer.userId, requestStatus };
  }
  const isAuthor = !!viewer.userId && viewer.userId === v.created_by && viewer.ws === v.workspace_id;
  // El autor ve todo, aun con recorte; los demás, lo que queda dentro.
  return { state: 'ok', video: toPublicDto(v, isAuthor), member: isAuthor, brand: await getRecBrand(v.workspace_id) };
}

/**
 * Vista previa del link (og:title, og:image) solo si cualquiera sin sesión
 * puede abrir el video: link público, sin contraseña ni vencido. Los
 * protegidos no dicen nada (ni el título).
 */
export async function publicPreview(locale: string, shareId: string): Promise<{ title: string; description: string; image: string | null; url: string } | null> {
  const v = await getPublicVideoRow(shareId);
  if (!v) return null;
  if (publicAccess(v, { ws: null, userId: null }, null) !== 'ok') return null;
  const dto = toPublicDto(v, false);
  const text = (dto.summary || dto.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    title: dto.title,
    description: text,
    image: dto.hasThumb ? `${recBaseUrl()}/api/rec/v/${shareId}/file?kind=thumb` : null,
    url: recShareUrl(locale, shareId),
  };
}
