import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';
import { appBase, e164, missingVoiceEnv, numberBelongsToAccount } from '@/lib/twilio-voice';
import { CONSENT_MAX, getVoiceSettings, saveVoiceSettings, VOICE_LANGUAGES, VoiceError } from '@/lib/crm-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  callerId: z.string().trim().max(32),
  recordCalls: z.boolean(),
  consentEnabled: z.boolean(),
  consentText: z.string().trim().max(CONSENT_MAX),
  transcribe: z.boolean(),
  language: z.enum(VOICE_LANGUAGES),
  inboundEnabled: z.boolean(),
});

/** Estado de la integración (qué falta configurar) y ajustes de llamadas del workspace. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const missing = missingVoiceEnv();
  return NextResponse.json({
    configured: missing.length === 0,
    missing,
    settings: await getVoiceSettings(user.id),
    twimlUrl: `${appBase()}/api/crm/voice/twiml`,
    inboundUrl: `${appBase()}/api/crm/voice/inbound`,
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const callerId = parsed.data.callerId ? e164(parsed.data.callerId) : '';
  if (callerId === null) return crmError(400, 'invalid_number');
  const current = await getVoiceSettings(user.id);
  // El número tiene que ser del account de Twilio de la instancia.
  if (callerId && callerId !== current.callerId && !(await numberBelongsToAccount(callerId))) {
    return crmError(400, 'number_not_in_account');
  }
  try {
    const settings = await saveVoiceSettings(user.id, { ...parsed.data, callerId });
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof VoiceError) return crmError(409, e.code);
    throw e;
  }
}
