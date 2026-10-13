import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { bulkEditIssues } from '@/lib/track-bulk';
import { bulkIssuesSchema } from '@/lib/track-schema';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Edición masiva de issues (hasta 200). Los issues de otro workspace se
 * saltean. Borrar en masa es solo para owner/admin.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bulkIssuesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (parsed.data.action === 'delete' && !isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const result = await bulkEditIssues(parsed.data, {
    teamId: user.team?.id ?? null,
    ownerId: user.id,
    actorId: realUserId(user),
  });
  return NextResponse.json(result);
}
