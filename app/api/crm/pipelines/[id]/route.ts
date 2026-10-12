import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deletePipeline, renamePipeline } from '@/lib/crm';
import { pipelineRenameSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = pipelineRenameSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const pipeline = await renamePipeline(user.id, params.id, parsed.data.name);
  if (!pipeline) return notFound();
  return NextResponse.json(pipeline);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await deletePipeline(user.id, params.id);
  if (!result.ok) {
    if (result.reason === 'not_empty') return crmError(409, 'pipeline_not_empty');
    return notFound();
  }
  return new NextResponse(null, { status: 204 });
}
