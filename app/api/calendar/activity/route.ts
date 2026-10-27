import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listCalActivity } from '@/lib/calendar-activity';
import { crmError, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?group=&before=<ISO> — registro de actividad de Cal (solo admins), el más nuevo primero. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const sp = req.nextUrl.searchParams;
  const entries = await listCalActivity(user.id, {
    group: sp.get('group') ?? undefined,
    before: sp.get('before')?.slice(0, 40) ?? undefined,
    limit: 100,
  });
  return NextResponse.json({ entries });
}
