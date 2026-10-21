import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { duplicateLink, getLinkForViewer, toLinkDto } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Copia del link con un slug nuevo; la respuesta es el link creado. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await limitByIp(req, 'link-create', 60, 60);
  if (limited) return limited;
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, id, viewerOf(user), 'edit');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  const result = await duplicateLink(link, realUserId(user), viewerOf(user));
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: result.code === 'quota_exceeded' ? 429 : 400 });
  }
  return NextResponse.json(toLinkDto(result.link), { status: 201 });
}
