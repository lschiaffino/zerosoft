import { NextRequest } from 'next/server';
import { addCandidateManually, listApplications, manualAddSchema } from '@/lib/hiring/candidates';
import { HiringError } from '@/lib/hiring/types';
import { hFail, hiringActor, hJson, readJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: postulaciones visibles (filtros: jobId, stageId, status, source, tag, knockedOut, q). */
export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const items = await listApplications(a.actor, {
    q: sp.get('q') ?? undefined,
    jobId: sp.get('jobId') ?? undefined,
    stageId: sp.get('stageId') ?? undefined,
    status: sp.get('status') ?? 'active',
    source: sp.get('source') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    knockedOut: sp.get('knockedOut') === '1',
  });
  return hJson({ applications: items });
}

/** POST (JSON o multipart con `resume`): carga manual de un candidato a un puesto. Un email repetido se une al candidato existente. */
export async function POST(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    let raw: unknown;
    let resume: { bytes: Buffer; filename: string } | null = null;
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      const tags = form.getAll('tags').filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      raw = { ...Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === 'string' && v !== '' && k !== 'tags')), ...(tags.length ? { tags } : {}) };
      const file = form.get('resume');
      if (file && typeof file !== 'string' && file.size > 0) resume = { bytes: Buffer.from(await file.arrayBuffer()), filename: file.name };
    } else {
      raw = await readJson(req);
    }
    const parsed = manualAddSchema.safeParse(raw);
    if (!parsed.success) throw new HiringError('invalid_input');
    return hJson(await addCandidateManually(a.actor, parsed.data, resume), 201);
  } catch (err) {
    return hFail(err);
  }
}
