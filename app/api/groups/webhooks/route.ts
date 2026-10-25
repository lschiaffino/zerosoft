import { NextResponse } from 'next/server';
import { createWebhook, listWebhooks, WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks';
import { UnsafeUrlError } from '@/lib/safe-fetch';
import { groupsError, groupsSession, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROUPS_EVENTS = WEBHOOK_EVENTS.filter((e) => e.startsWith('groups.'));

/**
 * Webhooks salientes con eventos de Groups (los mismos del workspace, en
 * webhooks / webhook_deliveries: firma HMAC, reintentos y log). Solo admins.
 */
export async function GET() {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  const all = await listWebhooks(s.ws);
  return NextResponse.json({ webhooks: all.filter((w) => w.events.some((e) => e.startsWith('groups.'))), events: GROUPS_EVENTS });
}

/** { url, events }: el secret (whsec_…) vuelve una sola vez. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const url = (str(b.url, 2000) ?? '').trim();
  if (!/^https?:\/\/\S+$/.test(url)) return groupsError(400, 'invalid_url');
  const events = strArr(b.events, 50).filter((e): e is WebhookEvent => (GROUPS_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) return groupsError(400, 'no_events');
  try {
    const res = await createWebhook(s.ws, { url, events, createdBy: s.me });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return groupsError(400, 'invalid_url');
    throw err;
  }
}
