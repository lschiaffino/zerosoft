import { NextRequest } from 'next/server';
import { bindOutboundCall, getVoiceSettings } from '@/lib/crm-voice';
import { dialTwiml, e164, readTwilioWebhook, rejectTwiml, twimlResponse } from '@/lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Voice URL de la TwiML App: Twilio lo pide cuando el navegador conecta.
 * Firma obligatoria; la llamada tiene que existir y ser de esa identidad.
 */
export async function POST(req: NextRequest) {
  const { ok, params } = await readTwilioWebhook(req);
  if (!ok) return twimlResponse(rejectTwiml(), 403);
  const callId = params.CallId ?? '';
  const call = callId ? await bindOutboundCall(callId, params.From ?? '', params.CallSid ?? '') : null;
  if (!call) return twimlResponse(rejectTwiml());
  const settings = await getVoiceSettings(call.user_id);
  const to = e164(call.to_number);
  if (!to || !settings.callerId) return twimlResponse(rejectTwiml());
  return twimlResponse(
    dialTwiml({
      callId: call.id,
      to,
      callerId: settings.callerId,
      record: call.recorded === 1,
      consent: settings.consentEnabled,
      transcribe: settings.transcribe,
      language: settings.language,
    }),
  );
}
