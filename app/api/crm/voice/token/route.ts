import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { crmError, limitAction, unauthorized } from '@/lib/crm-http';
import { fakeVoiceAllowed, voiceAccessToken, voiceConfigured, voiceIdentity } from '@/lib/twilio-voice';
import { getVoiceSettings } from '@/lib/crm-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Access token del Voice JS SDK para la persona logueada en este workspace
 * (una hora). En modo fake la UI usa el dispositivo simulado.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!voiceConfigured()) return crmError(400, 'voice_not_configured');
  const personId = realUserId(user);
  const limited = await limitAction(personId, 'voice-token', 120, 3600);
  if (limited) return limited;
  const settings = await getVoiceSettings(user.id);
  if (!settings.callerId) return crmError(400, 'no_caller_id');
  const identity = voiceIdentity(user.id, personId);
  return NextResponse.json(
    {
      identity,
      fake: fakeVoiceAllowed(),
      token: fakeVoiceAllowed() ? null : voiceAccessToken(identity, { ttlSec: 3600 }),
      ttlSec: 3600,
      inbound: settings.inboundEnabled,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
