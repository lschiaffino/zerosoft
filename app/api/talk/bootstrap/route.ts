import { NextRequest, NextResponse } from 'next/server';
import { withTalk } from '@/lib/talk-http';
import { loadTalkBootstrap } from '@/lib/talk-boot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sidebar y estado general (al volver a la pestaña o cuando cambia un canal). */
export async function GET(_req: NextRequest) {
  return withTalk(async ({ actor, user }) => NextResponse.json(await loadTalkBootstrap(actor, { user })));
}
