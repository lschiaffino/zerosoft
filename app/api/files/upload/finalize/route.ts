import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { DirectUploadError, finalizeDirectUpload, isPurpose } from '@/lib/files/direct-upload';
import { fileUrl } from '@/lib/files/store';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Sin store privado, el archivo (hasta cientos de MB) se cifra en stream acá.
export const maxDuration = 300;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST { pathname, purpose, name }: después de la subida directa. Registra el
 * archivo como privado (y lo cifra si hace falta) y devuelve su URL de
 * /api/files, la única que se guarda y se manda al navegador.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const person = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('files:direct', person, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { pathname?: unknown; purpose?: unknown; name?: unknown } | null;
  if (!body || typeof body.pathname !== 'string' || !isPurpose(body.purpose)) return json({ error: 'invalid_input' }, 400);
  const name = typeof body.name === 'string' ? body.name.slice(0, 255) : 'file';
  try {
    const row = await finalizeDirectUpload({ pathname: body.pathname, purpose: body.purpose, name, workspaceId: user.id, personId: person });
    return json({ url: fileUrl(row), size: row.size, mimetype: row.mime, name: row.name }, 201);
  } catch (err) {
    if (err instanceof DirectUploadError) return json({ error: err.code }, err.status);
    console.error('[files] no se pudo finalizar una subida', err instanceof Error ? err.name : 'error');
    return json({ error: 'upload_failed' }, 500);
  }
}
