import { NextRequest } from 'next/server';
import { envelopeDto, envelopeFile, listRecipients, setDocument } from '@/lib/sign/core';
import { docsPagePdf } from '@/lib/sign/integrations';
import { MAX_PDF_BYTES } from '@/lib/sign/pdf';
import { pdfFromForm, pdfResponse, readJson, sFail, signActor, signLimit, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?v=original|final (&download=1): el PDF, solo para quien ve el sobre. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const which = req.nextUrl.searchParams.get('v') === 'final' ? 'final' : 'original';
    const file = await envelopeFile(a.actor, (await params).id, which);
    return pdfResponse(file.bytes, file.name, req.nextUrl.searchParams.get('download') !== '1');
  } catch (err) {
    return sFail(err);
  }
}

/** POST: documento del borrador. multipart con `file` (PDF) o JSON { docsPageId } (una página de Docs). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'upload', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const id = (await params).id;
    let file: { bytes: Buffer; name: string };
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const f = await pdfFromForm(req, MAX_PDF_BYTES);
      file = { bytes: f.bytes, name: f.name };
    } else {
      const body = (await readJson(req)) as { docsPageId?: unknown } | null;
      if (typeof body?.docsPageId !== 'string' || !body.docsPageId) return sJson({ error: 'invalid_input' }, 400);
      const pdf = await docsPagePdf(a.user, a.actor, body.docsPageId);
      file = { bytes: pdf.bytes, name: pdf.name };
    }
    const env = await setDocument(a.actor, id, file);
    return sJson({ envelope: await envelopeDto(a.actor, env, await listRecipients(id), { fields: true }) });
  } catch (err) {
    return sFail(err);
  }
}
