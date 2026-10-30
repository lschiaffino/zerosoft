import { NextRequest, NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { listInbox, type InboxFilter } from '@/lib/social-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bandeja: ?status=open|done|all, ?kind=comment|mention|dm, ?account=, ?assigned=me|none, ?q=. */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const kind = sp.get('kind');
    const assigned = sp.get('assigned');
    const filter: InboxFilter = {
      status: status === 'done' || status === 'all' ? status : 'open',
      kind: kind === 'comment' || kind === 'mention' || kind === 'dm' ? kind : undefined,
      accountId: sp.get('account') ?? undefined,
      assigned: assigned === 'me' || assigned === 'none' ? assigned : undefined,
      q: sp.get('q')?.slice(0, 200) ?? undefined,
    };
    return NextResponse.json({ items: await listInbox(actor, filter) });
  });
}
