import { NextRequest } from 'next/server';
import { getRecSettings, setBrandLogo } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { saveRecAsset } from '@/lib/rec-upload';
import { sniffImageType } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 1024 * 1024;

/** Logo de la marca (JPEG, PNG o WebP, hasta 1 MB: entra en el límite de 4,5 MB de un request). SVG no: puede llevar scripts. */
export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  if (!s.actor.admin) return recJson({ error: 'forbidden' }, 403);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX + 4096) return recJson({ error: 'file_too_large' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return recJson({ error: 'invalid_file' }, 400);
  if (file.size > MAX) return recJson({ error: 'file_too_large' }, 413);
  const body = Buffer.from(await file.arrayBuffer());
  // El tipo sale del contenido, no de lo que dice el navegador.
  const type = sniffImageType(body);
  if (!type) return recJson({ error: 'invalid_type' }, 415);
  try {
    const url = await saveRecAsset(s.actor.ws, `brand-${crypto.randomUUID()}`, 'thumb', type, body);
    await setBrandLogo(s.actor, url);
    return recJson({ settings: await getRecSettings(s.actor.ws) });
  } catch (err) {
    return recFail(err);
  }
}

export async function DELETE() {
  const s = await recActor();
  if ('res' in s) return s.res;
  try {
    await setBrandLogo(s.actor, null);
    return recJson({ settings: await getRecSettings(s.actor.ws) });
  } catch (err) {
    return recFail(err);
  }
}
