import { NextRequest } from 'next/server';
import { listMyFiles, saveDesignFile } from '@/lib/design';
import { DESIGN_MAX_UPLOAD_BYTES } from '@/lib/design-image';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mis subidas (panel "Subidas" del editor). */
export async function GET() {
  const s = await designActor();
  if ('res' in s) return s.res;
  return designJson({ files: await listMyFiles(s.actor) });
}

/**
 * Sube una imagen (multipart, campo `file`; `kind=logo` para el kit de marca).
 * El tipo se lee de los bytes: PNG, JPEG, GIF o WebP, hasta 4 MB (DESIGN_MAX_UPLOAD_BYTES).
 */
export async function POST(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > DESIGN_MAX_UPLOAD_BYTES + 64 * 1024) return designJson({ error: 'too_large' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return designJson({ error: 'invalid_input' }, 400);
  if (file.size > DESIGN_MAX_UPLOAD_BYTES) return designJson({ error: 'too_large' }, 413);
  const kind = form?.get('kind') === 'logo' ? 'logo' : 'upload';
  try {
    const saved = await saveDesignFile(s.actor, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, kind });
    return designJson({ file: saved }, 201);
  } catch (err) {
    return designFail(err);
  }
}
