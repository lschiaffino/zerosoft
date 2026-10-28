import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { revokeApiKey } from '@/lib/api-auth';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const onlyMine = isWorkspaceAdmin(user) ? undefined : realUserId(user);
  if (!(await revokeApiKey(user.id, params.id, onlyMine))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  await logCalActivity(user.id, realUserId(user), 'api.key_revoked', { type: 'api_key', id: params.id });
  return new NextResponse(null, { status: 204 });
}
