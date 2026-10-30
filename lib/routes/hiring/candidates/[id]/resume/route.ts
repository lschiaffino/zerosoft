import { NextRequest } from 'next/server';
import { fileBlockResponse } from '@/lib/upload-serve';
import type { DocsBlock } from '@/lib/docs-types';
import { requireVisibleCandidate } from '@/lib/hiring/candidates';
import { hFail, hiringActor, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET (?download=1): el resume, solo para quien ve al candidato. El PDF se muestra en el navegador; DOC y DOCX se descargan. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const c = await requireVisibleCandidate(a.actor, (await params).id);
    if (!c.resume_url) return hJson({ error: 'not_found' }, 404);
    const block = { id: 'resume', type: 'file', url: c.resume_url, mime: c.resume_mime ?? 'application/octet-stream', name: c.resume_name ?? 'resume' } as unknown as DocsBlock & { url: string };
    const res = await fileBlockResponse(block, { download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') });
    return res ?? hJson({ error: 'not_found' }, 404);
  } catch (err) {
    return hFail(err);
  }
}
