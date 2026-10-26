import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deletePlaybook, getPlaybook, updatePlaybook } from '@/lib/crm-playbooks';
import { playbookUpdateSchema } from '@/lib/crm-playbooks-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const playbook = await getPlaybook(user.id, id);
  return playbook ? NextResponse.json(playbook) : notFound();
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = playbookUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const playbook = await updatePlaybook(user.id, id, parsed.data);
  return playbook ? NextResponse.json(playbook) : notFound();
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  return (await deletePlaybook(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
