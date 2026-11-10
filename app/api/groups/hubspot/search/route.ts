import { NextResponse } from 'next/server';
import { HUBSPOT_TYPES, redactHubspot, searchHubspot, type HubspotType } from '@/lib/groups-hubspot';
import { chatGuard, groupsError, groupsSession, handleGroupsError } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ?chat=<id>&type=company|deal|contact&q=<texto>: busca en HubSpot por nombre
 * para vincular ese chat. Hay que poder ver el chat; los invitados no buscan.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const p = new URL(req.url).searchParams;
  const type = HUBSPOT_TYPES.find((k) => k === p.get('type')) as HubspotType | undefined;
  if (!type) return groupsError(400, 'invalid_input');
  const guard = await chatGuard(s, p.get('chat') ?? '');
  if (guard instanceof NextResponse) return guard;
  try {
    const results = await searchHubspot(s.ws, type, p.get('q') ?? '');
    return NextResponse.json({ results: results.map((r) => redactHubspot(guard.viewer.mask, r)) });
  } catch (err) {
    return handleGroupsError(err);
  }
}
