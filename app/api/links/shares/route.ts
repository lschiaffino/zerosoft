import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { createShare, listShares, shareCreateSchema, type ShareTarget } from '@/lib/link-shares';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Quién puede compartir: un link, quien lo ve (carpetas); un tag, solo
 * admins (el tag junta links de carpetas que otra persona quizás no ve).
 */
async function canShare(user: SessionUser, target: ShareTarget): Promise<NextResponse | null> {
  if ('linkId' in target) {
    const found = await getLinkForViewer(user.id, target.linkId, viewerOf(user), 'view');
    if ('status' in found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return null;
  }
  return isWorkspaceAdmin(user) ? null : NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

/** GET ?linkId= | ?tag= — páginas públicas vigentes de ese link o tag. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const parsed = shareCreateSchema.safeParse(sp.get('linkId') ? { linkId: sp.get('linkId') } : { tag: sp.get('tag') ?? '' });
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const denied = await canShare(user, parsed.data);
  if (denied) return denied;
  return NextResponse.json({ shares: await listShares(user.id, parsed.data) });
}

/** POST { linkId } | { tag } — crea una página pública de solo lectura. */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'link-share', 30, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = shareCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const denied = await canShare(user, parsed.data);
  if (denied) return denied;
  const res = await createShare(user.id, parsed.data, realUserId(user));
  if (!res.ok) return NextResponse.json({ error: res.code }, { status: res.code === 'not_found' ? 404 : 409 });
  return NextResponse.json(res.share, { status: 201 });
}
