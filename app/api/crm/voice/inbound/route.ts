import { NextRequest } from 'next/server';
import { createInboundCall, defaultConsentText } from '@/lib/crm-voice';
import { dialTwiml, readTwilioWebhook, rejectTwiml, twimlResponse } from '@/lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Voice URL del número del workspace: una llamada entrante suena en los
 * navegadores del equipo (con el CRM abierto) y queda registrada en el
 * timeline del contacto que llama (si existe).
 */
export async function POST(req: NextRequest) {
  const { ok, params } = await readTwilioWebhook(req);
  if (!ok) return twimlResponse(rejectTwiml(), 403);
  const res = await createInboundCall(params.To ?? '', params.From ?? '', params.CallSid ?? '');
  if (!res || !res.clients.length) return twimlResponse(rejectTwiml());
  const { call, settings } = res;
  return twimlResponse(
    dialTwiml({
      callId: call.id,
      to: '',
      callerId: '',
      record: call.recorded === 1,
      consent: settings.consentEnabled,
      consentText: settings.consentText || defaultConsentText(settings.language),
      transcribe: settings.transcribe,
      language: settings.language,
      clients: res.clients,
    }),
  );
}
