import type { NextRequest } from 'next/server';
import { hFail, hiringActor, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';
import { actOnJobApproval, jobApprovalSchema } from '@/lib/hiring/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { action: request | approve | reject, note }: la cadena de aprobación para publicar el puesto. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await actOnJobApproval(a.actor, (await params).id, await parseBody(req, jobApprovalSchema)));
  } catch (err) {
    return hFail(err);
  }
}
