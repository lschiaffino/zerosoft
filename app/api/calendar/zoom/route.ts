import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { AppError, connectZoom, disconnectApp, isAppConnected } from '@/lib/crm-apps';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Zoom del workspace para Cal: la misma app Server-to-Server que usa el CRM
 * (una conexión para los dos). Cada reserva con Zoom sin link fijo genera su
 * reunión. Solo admins conectan o desconectan.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ connected: await isAppConnected(user.id, 'zoom') });
}

const schema = z.object({
  accountId: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(300),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    await connectZoom(user.id, parsed.data, realUserId(user));
  } catch (err) {
    if (err instanceof AppError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
  await logCalActivity(user.id, realUserId(user), 'integration.connected', { type: 'integration', id: 'zoom', summary: 'Zoom' });
  return NextResponse.json({ connected: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  await disconnectApp(user.id, 'zoom');
  await logCalActivity(user.id, realUserId(user), 'integration.disconnected', { type: 'integration', id: 'zoom', summary: 'Zoom' });
  return NextResponse.json({ connected: false });
}
