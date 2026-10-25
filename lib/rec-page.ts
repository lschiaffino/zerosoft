/**
 * Rec: estado de la página pública de un video (/v/<id>) para el render del
 * servidor. Server-only.
 */
import { cookies } from 'next/headers';
import { getCurrentUser } from './session';
import { getPublicVideoRow, publicAccess, toPublicDto, unlockCookieName, type PublicAccess, type PublicVideoDto } from './rec';

export function recBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function recShareUrl(locale: string, shareId: string): string {
  return `${recBaseUrl()}/${locale}/v/${shareId}`;
}

export async function resolvePublicPage(
  shareId: string,
): Promise<{ state: 'not_found' } | { state: Exclude<PublicAccess, 'ok'>; title: string } | { state: 'ok'; video: PublicVideoDto; member: boolean }> {
  const v = await getPublicVideoRow(shareId);
  if (!v) return { state: 'not_found' };
  const user = await getCurrentUser();
  const jar = await cookies();
  const access = publicAccess(v, user?.id ?? null, jar.get(unlockCookieName(v.share_id))?.value ?? null);
  // El título no se muestra si hay contraseña o es solo del workspace.
  if (access !== 'ok') return { state: access, title: access === 'expired' ? v.title : '' };
  return { state: 'ok', video: toPublicDto(v), member: user?.id === v.workspace_id };
}
