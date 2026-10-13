import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteCredential, updateCredential } from '@/lib/flow-credentials';
import { credentialUpdateSchema } from '@/lib/flow-credentials-schema';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Renombra o actualiza campos. Secretos vacíos = se conservan. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = credentialUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, parsed.error.issues[0]?.path[0] === 'name' ? 'invalid_name' : 'invalid_input');
  const res = await updateCredential(user.id, id, parsed.data);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(res.error === 'duplicate_name' ? 409 : 400, res.error, { field: res.field });
  }
  return NextResponse.json({ credential: res.credential });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  if (!(await deleteCredential(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
