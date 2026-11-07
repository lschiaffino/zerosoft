import type { NextRequest } from 'next/server';
import { hFail, hiringActor, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';
import { mergeCandidates, mergeSchema } from '@/lib/hiring/transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { dropId }: fusiona otro registro en este. Hay que gestionar todas las postulaciones de los dos. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { dropId } = await parseBody(req, mergeSchema);
    await mergeCandidates(a.actor, (await params).id, dropId);
    return hJson({ ok: true });
  } catch (err) {
    return hFail(err);
  }
}
