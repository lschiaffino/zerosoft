import { NextRequest } from 'next/server';
import { defaultConsentText, getCallById, getVoiceSettings } from '@/lib/crm-voice';
import { readTwilioWebhook, rejectTwiml, sayTwiml, twiml, twimlResponse } from '@/lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que escucha el contacto al atender, antes de conectar: el aviso de grabación. */
export async function POST(req: NextRequest) {
  const { ok } = await readTwilioWebhook(req);
  if (!ok) return twimlResponse(rejectTwiml(), 403);
  const call = await getCallById(req.nextUrl.searchParams.get('call') ?? '');
  if (!call) return twimlResponse(twiml(''));
  const s = await getVoiceSettings(call.user_id);
  return twimlResponse(sayTwiml(s.consentText || defaultConsentText(s.language), s.language));
}
