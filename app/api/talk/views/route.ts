import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listActivity, listThreads } from '@/lib/talk';
import { listDrafts, listLater, listScheduled } from '@/lib/talk-extras';

/** Vistas del sidebar: ?view=threads|activity|later|later-done|drafts|scheduled. */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => {
    const view = req.nextUrl.searchParams.get('view');
    switch (view) {
      case 'threads':
        return NextResponse.json({ threads: await listThreads(actor) });
      case 'activity':
        return NextResponse.json({ items: await listActivity(actor) });
      case 'later':
        return NextResponse.json({ items: await listLater(actor, 'open') });
      case 'later-done':
        return NextResponse.json({ items: await listLater(actor, 'done') });
      case 'drafts':
        return NextResponse.json({ drafts: await listDrafts(actor), scheduled: await listScheduled(actor) });
      default:
        return jsonError(400, 'invalid_input');
    }
  });
}
