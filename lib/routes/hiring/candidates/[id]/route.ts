import { NextRequest } from 'next/server';
import { candidatePatchSchema, deleteCandidate, getCandidateProfile, updateCandidate } from '@/lib/hiring/candidates';
import { hFail, hiringActor, hJson, readJson } from '@/lib/hiring/http';
import { HiringError } from '@/lib/hiring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: perfil con las postulaciones que la persona ve (404 si no ve ninguna). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const profile = await getCandidateProfile(a.actor, (await params).id);
  return profile ? hJson(profile) : hJson({ error: 'not_found' }, 404);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const parsed = candidatePatchSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HiringError('invalid_input');
    return hJson({ candidate: await updateCandidate(a.actor, (await params).id, parsed.data) });
  } catch (err) {
    return hFail(err);
  }
}

/** DELETE: borra todos los datos del candidato (pedido de borrado). Admin o quien gestiona todas sus postulaciones. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    await deleteCandidate(a.actor, (await params).id);
    return hJson({ ok: true });
  } catch (err) {
    return hFail(err);
  }
}
