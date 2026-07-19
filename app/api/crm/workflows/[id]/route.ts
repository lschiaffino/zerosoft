import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteWorkflow, getWorkflow, updateWorkflow } from '@/lib/crm-workflows';
import { workflowUpdateSchema } from '@/lib/crm-workflows-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const workflow = await getWorkflow(user.id, params.id);
  if (!workflow) return notFound();
  return NextResponse.json(workflow);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = workflowUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const workflow = await updateWorkflow(user.id, params.id, parsed.data);
  if (!workflow) return notFound();
  return NextResponse.json(workflow);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteWorkflow(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
