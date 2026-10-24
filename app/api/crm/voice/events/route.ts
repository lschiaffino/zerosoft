import { after, NextRequest } from 'next/server';
import { finishCall, getCallById, handleTranscriptionEvent, saveRecording, summarizeIfReady } from '@/lib/crm-voice';
import { callTo, readTwilioWebhook, rejectTwiml, twiml, twimlResponse } from '@/lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhooks de Twilio de una llamada (firmados): fin del <Dial> (duración y
 * resultado → actividad), grabación lista y transcripción en tiempo real.
 */
export async function POST(req: NextRequest) {
  const { ok, params } = await readTwilioWebhook(req);
  if (!ok) return twimlResponse(rejectTwiml(), 403);
  const sp = req.nextUrl.searchParams;
  const call = await getCallById(sp.get('call') ?? '');
  if (!call) return twimlResponse(twiml(''));
  const kind = sp.get('kind');

  if (kind === 'dial') {
    const answeredBy = call.direction === 'inbound' && params.DialCallSid ? await callTo(params.DialCallSid) : null;
    await finishCall(call.id, {
      status: params.DialCallStatus || 'completed',
      durationSec: Number(params.DialCallDuration ?? 0) || 0,
      answeredBy,
    });
    after(() => summarizeIfReady(call.id));
    // Fin del <Dial>: se corta la llamada del navegador.
    return twimlResponse(twiml('<Hangup/>'));
  }
  if (kind === 'recording') {
    if (params.RecordingStatus === 'completed' && params.RecordingSid) {
      await saveRecording(call.id, params.RecordingSid, Number(params.RecordingDuration ?? 0) || 0);
    }
    return new Response(null, { status: 204 });
  }
  if (kind === 'transcription') {
    await handleTranscriptionEvent(call.id, params);
    if (params.TranscriptionEvent === 'transcription-stopped') after(() => summarizeIfReady(call.id));
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 204 });
}
