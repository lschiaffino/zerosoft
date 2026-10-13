import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteStage, updateStage } from '@/lib/crm';
import { stageUpdateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = stageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const stage = await updateStage(user.id, params.id, parsed.data);
  if (!stage) return notFound();
  return NextResponse.json(stage);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await deleteStage(user.id, params.id);
  if (!result.ok) {
    if (result.reason === 'not_empty') return crmError(409, 'stage_has_deals');
    return notFound();
  }
  return new NextResponse(null, { status: 204 });
}
