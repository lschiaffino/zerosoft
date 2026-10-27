import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { deleteSmsSettings, getSmsSettings, saveSmsSettings, SmsError } from '@/lib/calendar-sms';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cuenta de Twilio del workspace para los pasos de workflow por SMS (el token nunca vuelve). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await getSmsSettings(user.id));
}

const schema = z.object({
  accountSid: z.string().trim().max(64),
  authToken: z.string().trim().max(64).optional(),
  fromNumber: z.string().trim().max(64),
  /** Países permitidos (códigos como "+54, +1"). Vacío = el del número que envía. */
  allowedCodes: z.string().trim().max(400).optional(),
  dailyLimit: z.number().int().min(1).max(5000).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const view = await saveSmsSettings(user.id, parsed.data);
    await logCalActivity(user.id, realUserId(user), 'integration.connected', { type: 'integration', id: 'twilio', summary: 'Twilio SMS' });
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof SmsError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  await deleteSmsSettings(user.id);
  await logCalActivity(user.id, realUserId(user), 'integration.disconnected', { type: 'integration', id: 'twilio', summary: 'Twilio SMS' });
  return NextResponse.json(await getSmsSettings(user.id));
}
