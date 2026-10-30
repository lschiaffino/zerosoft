import { NextRequest, NextResponse } from 'next/server';
import { uploadPublicFile } from '@/lib/forms/responses';
import { FORMS_FILE_MAX_BYTES } from '@/lib/forms/files';
import { FormsError } from '@/lib/forms/types';
import { formsLimit } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST multipart (slug, question, file): archivo para una pregunta de archivo
 * de un form abierto. El tipo se verifica por los bytes y se guarda privado;
 * devuelve el id que el envío referencia. 20 subidas por hora por IP y form.
 */
export async function POST(req: NextRequest) {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > FORMS_FILE_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'file_size' }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const slug = String(form?.get('slug') ?? '');
  const question = String(form?.get('question') ?? '');
  const file = form?.get('file');
  if (!slug || !question || !(file instanceof File)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const limited = await formsLimit(req, 'upload', 20, 3600, slug);
  if (limited) return limited;
  try {
    const out = await uploadPublicFile(slug, question, { bytes: Buffer.from(await file.arrayBuffer()), filename: file.name || 'file' });
    return NextResponse.json({ file: out });
  } catch (err) {
    if (err instanceof FormsError) return NextResponse.json({ error: err.code, ...(err.detail ?? {}) }, { status: err.status });
    throw err;
  }
}
