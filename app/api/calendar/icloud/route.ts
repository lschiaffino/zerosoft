import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIntegration } from '@/lib/integrations';
import { connectICloud, ICloudError, ICLOUD_CALENDAR_PROVIDER, invalidateICloudBusyCache } from '@/lib/icloud-calendar';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { limitByIp } from '@/lib/rate-limit';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ appleId: z.string().trim().min(3).max(320), password: z.string().trim().min(16).max(40) });

/** Conecta el iCloud de la persona logueada (Apple ID + contraseña de app, guardada cifrada). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitByIp(req, 'icloud-connect', 10, 600);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const me = realUserId(user);
  try {
    await connectICloud(me, parsed.data.appleId, parsed.data.password);
  } catch (err) {
    if (err instanceof ICloudError) return crmError(err.code === 'icloud_auth_failed' ? 400 : err.code === 'invalid_input' ? 400 : 502, err.code);
    return crmError(500, 'generic');
  }
  invalidateICloudBusyCache(me);
  await logCalActivity(user.id, me, 'integration.connected', { type: 'integration', id: 'icloud', summary: 'iCloud' });
  return NextResponse.json({ connected: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const me = realUserId(user);
  await deleteIntegration(me, ICLOUD_CALENDAR_PROVIDER);
  invalidateICloudBusyCache(me);
  await logCalActivity(user.id, me, 'integration.disconnected', { type: 'integration', id: 'icloud', summary: 'iCloud' });
  return NextResponse.json({ connected: false });
}
