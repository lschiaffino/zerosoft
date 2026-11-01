import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getDb, type UserRow } from '@/lib/db';
import { resolveConsentWorkspace, sameSiteRequest } from '@/lib/oauth/consent';
import { decideDevice, getClient, pendingDeviceByUserCode } from '@/lib/oauth/store';
import { getCurrentUser, realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().min(1).max(20),
  decision: z.enum(['lookup', 'approve', 'deny']),
  scope: z.enum(['read', 'read write']).optional(),
  teamId: z.string().max(100).nullable().optional(),
});

/** Pantalla del código de dispositivo: buscarlo y decidir. Tope estricto: el código es corto. */
export async function POST(req: NextRequest) {
  if (!sameSiteRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const personId = realUserId(user);
  const limit = await rateLimit(`oauth-device-code:${personId}`, 10, 60);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const row = await pendingDeviceByUserCode(parsed.data.code);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (parsed.data.decision === 'lookup') {
    const client = await getClient(row.client_id);
    return NextResponse.json({ clientName: client?.name ?? 'Unnamed client', scope: row.scope });
  }
  if (parsed.data.decision === 'deny') {
    await decideDevice(row, { approve: false });
    return NextResponse.json({ ok: true });
  }
  const asked = row.scope.split(' ');
  const chosen = parsed.data.scope ?? row.scope;
  if (chosen.split(' ').some((s) => !asked.includes(s))) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  const real = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(personId)) as UserRow;
  const team = await resolveConsentWorkspace(real, parsed.data.teamId);
  if (team === undefined) return NextResponse.json({ error: 'workspace_not_found' }, { status: 403 });
  const ok = await decideDevice(row, { approve: true, userId: personId, teamId: team, scope: chosen });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
