import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteSalesTeam, updateSalesTeam } from '@/lib/crm-visibility';
import { salesTeamUpdateSchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = salesTeamUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const team = await updateSalesTeam(user.id, id, parsed.data);
  if (!team) return notFound();
  return NextResponse.json(team);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  if (!(await deleteSalesTeam(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
