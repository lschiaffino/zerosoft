import { NextRequest } from 'next/server';
import { setTemplateDocument, templateDto, templateFile } from '@/lib/sign/templates';
import { MAX_PDF_BYTES } from '@/lib/sign/pdf';
import { pdfFromForm, pdfResponse, sFail, signActor, signLimit, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const f = await templateFile(a.actor, (await params).id);
    return pdfResponse(f.bytes, f.name);
  } catch (err) {
    return sFail(err);
  }
}

/** POST multipart `file`: el PDF de la plantilla (limpio de scripts y acciones). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'upload', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const f = await pdfFromForm(req, MAX_PDF_BYTES);
    return sJson({ template: templateDto(await setTemplateDocument(a.actor, (await params).id, { bytes: f.bytes, name: f.name }), a.actor) });
  } catch (err) {
    return sFail(err);
  }
}
