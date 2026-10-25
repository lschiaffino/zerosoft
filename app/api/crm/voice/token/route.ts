import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { limitAction, unauthorized } from '@/lib/crm-http';
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
  // Sin Twilio o sin número todavía no es un error: el dock lo consulta en cada
  // página del CRM y responde "no disponible" sin ensuciar la consola.
  if (!voiceConfigured()) return unavailable('voice_not_configured');
  const settings = await getVoiceSettings(user.id);
  if (!settings.callerId) return unavailable('no_caller_id');
  // El límite cuenta solo los tokens que se emiten (el dock pide uno por carga de página).
  const personId = realUserId(user);
  const limited = await limitAction(personId, 'voice-token', 600, 3600);
  if (limited) return limited;
  const identity = voiceIdentity(user.id, personId);
  return NextResponse.json(
    {
      available: true,
      identity,
      fake: fakeVoiceAllowed(),
      token: fakeVoiceAllowed() ? null : voiceAccessToken(identity, { ttlSec: 3600 }),
      ttlSec: 3600,
      inbound: settings.inboundEnabled,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

function unavailable(reason: 'voice_not_configured' | 'no_caller_id') {
  return NextResponse.json({ available: false, reason }, { headers: { 'cache-control': 'no-store' } });
}
