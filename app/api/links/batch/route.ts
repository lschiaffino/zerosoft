import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { bulkLinkAction, linkBulkActionSchema } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/links/batch — acciones masivas de la tabla de links:
 * { action: 'archive' | 'unarchive' | 'delete', ids } o { action: 'tag', ids, tag }.
 * Solo afecta links del workspace del usuario (ids ajenos se ignoran).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = linkBulkActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const affected = await bulkLinkAction(user.id, parsed.data);
  return NextResponse.json({ ok: true, affected });
}
