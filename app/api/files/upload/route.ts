import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { directMode, incomingPrefix, isIncomingPathname, isPurpose, PURPOSES, tokenConstraints } from '@/lib/files/direct-upload';
import { privateFilesToken } from '@/lib/files/store';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Subida directa del navegador al storage (lib/files/direct-upload.ts).
 * GET: cómo subir (mode 'server' = por la ruta de la app). POST: firma un
 * token de @vercel/blob/client para un solo pathname bajo la carpeta de
 * subidas en curso de la persona.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const purpose = new URL(req.url).searchParams.get('purpose');
  const mode = directMode();
  const person = user.actingUser?.id ?? user.id;
  return json({
    mode,
    access: mode === 'private' ? 'private' : 'public',
    prefix: incomingPrefix(person),
    ...(isPurpose(purpose) ? { max: PURPOSES[purpose].max } : {}),
  });
}

export async function POST(req: Request) {
  const mode = directMode();
  if (mode === 'server') return json({ error: 'client_upload_unavailable' }, 501);
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== 'object' || !('type' in body)) return json({ error: 'invalid_input' }, 400);
  // El aviso de "subida terminada" lo manda Vercel sin sesión: no se usa (el navegador llama a finalize).
  if (body.type !== 'blob.generate-client-token') return json({ ok: true });
  const user = await getCurrentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const person = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('files:direct', person, 60);
  if (limited) return limited;
  try {
    const result = await handleUpload({
      body,
      request: req,
      ...(mode === 'private' ? { token: privateFilesToken()! } : {}),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let purpose: unknown = null;
        try {
          purpose = (JSON.parse(clientPayload ?? 'null') as { purpose?: unknown } | null)?.purpose;
        } catch {
          purpose = null;
        }
        if (!isPurpose(purpose)) throw new Error('invalid_purpose');
        if (!isIncomingPathname(pathname, person)) throw new Error('pathname_not_allowed');
        return tokenConstraints(purpose, pathname);
      },
    });
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'file_type_not_allowed') return json({ error: 'file_type_not_allowed' }, 415);
    if (msg === 'pathname_not_allowed' || msg === 'invalid_purpose') return json({ error: 'forbidden' }, 403);
    return json({ error: 'upload_failed' }, 400);
  }
}
