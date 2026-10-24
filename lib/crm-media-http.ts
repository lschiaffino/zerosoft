/**
 * Rutas de documentos y videos del CRM: sesión, permisos y subida. La subida
 * va directo a Vercel Blob desde el navegador cuando hay BLOB_READ_WRITE_TOKEN
 * (/api/crm/media/upload firma el token; las funciones no aceptan cuerpos de
 * más de 4,5 MB) y por multipart al disco local en dev y self-host.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from './session';
import { saveUpload, UploadError } from './uploads';
import { MediaError } from './crm-media';
import { isAllowedVideoType, MAX_DOCUMENT_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_BYTES_LOCAL } from './crm-media-schema';
import { crmError, unauthorized } from './crm-http';

export async function mediaUser() {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  return { user, actor: realUserId(user), admin: isWorkspaceAdmin(user) } as const;
}

/** Renombrar o borrar: admins o quien lo subió. */
export function canManage(u: { actor: string; admin: boolean }, createdBy: string | null): boolean {
  return u.admin || !createdBy || createdBy === u.actor;
}

export function mediaFail(err: unknown) {
  if (err instanceof MediaError) return crmError(err.status, err.code);
  if (err instanceof UploadError) return crmError(err.status, err.code);
  throw err;
}

export function directUploadEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Archivo subido por multipart (`file`) al almacenamiento local. */
export async function storeMultipart(
  form: FormData | null,
  kind: 'document' | 'video',
): Promise<{ filename: string; contentType: string; size: number; url: string; fields: Record<string, string> }> {
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new MediaError('invalid_file');
  const type = (file.type || '').toLowerCase();
  if (kind === 'document' && type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new MediaError('pdf_only', 415);
  if (kind === 'video' && !isAllowedVideoType(type)) throw new MediaError('video_only', 415);
  const max = kind === 'document' ? MAX_DOCUMENT_BYTES : MAX_VIDEO_BYTES_LOCAL;
  if (file.size > max) throw new MediaError('file_too_large', 413);
  const url = await saveUpload('crm', file.name || (kind === 'document' ? 'document.pdf' : 'video.webm'), kind === 'document' ? 'application/pdf' : type, Buffer.from(await file.arrayBuffer()));
  const fields: Record<string, string> = {};
  form!.forEach((v, k) => {
    if (typeof v === 'string') fields[k] = v.slice(0, 2000);
  });
  return { filename: file.name.slice(0, 255), contentType: kind === 'document' ? 'application/pdf' : type, size: file.size, url, fields };
}

export const UPLOAD_LIMITS = { document: MAX_DOCUMENT_BYTES, video: MAX_VIDEO_BYTES };

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}
