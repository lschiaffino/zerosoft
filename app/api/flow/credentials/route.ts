import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCredential, listCredentials } from '@/lib/flow-credentials';
import { credentialCreateSchema } from '@/lib/flow-credentials-schema';
import { canEditFlows, flowError, forbidden, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Credenciales del workspace, sin secretos (cualquier miembro las ve). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ credentials: await listCredentials(user.id), canEdit: canEditFlows(user) });
}

/** Crea una credencial (se cifra al guardar). Solo admins. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = credentialCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    return flowError(400, field === 'name' ? 'invalid_name' : field === 'type' ? 'invalid_type' : 'invalid_input');
  }
  const res = await createCredential(user.id, realUserId(user), parsed.data);
  if (!res.ok) return flowError(res.error === 'duplicate_name' ? 409 : 400, res.error, { field: res.field });
  return NextResponse.json({ credential: res.credential }, { status: 201 });
}
