import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createLeadStage, ensureLeadStages } from '@/lib/crm-leads';
import { leadStageCreateSchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pipeline de leads (se siembra con las etapas de HubSpot la primera vez). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await ensureLeadStages(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = leadStageCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createLeadStage(user.id, parsed.data), { status: 201 });
}
