import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteStage, updateStage } from '@/lib/crm';
import { stageUpdateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = stageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const stage = updateStage(user.id, params.id, parsed.data);
  if (!stage) return notFound();
  return NextResponse.json(stage);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const result = deleteStage(user.id, params.id);
  if (!result.ok) {
    if (result.reason === 'not_empty') return crmError(409, 'stage_has_deals');
    return notFound();
  }
  return new NextResponse(null, { status: 204 });
}
