import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createSalesTeam, listSalesTeams } from '@/lib/crm-visibility';
import { salesTeamCreateSchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ teams: await listSalesTeams(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = salesTeamCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createSalesTeam(user.id, parsed.data), { status: 201 });
}
