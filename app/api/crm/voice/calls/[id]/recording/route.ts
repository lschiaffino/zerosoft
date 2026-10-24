import { NextRequest } from 'next/server';
import { notFound, unauthorized } from '@/lib/crm-http';
import { callForSession } from '@/lib/crm-voice-http';
import { fakeVoiceAllowed, fetchRecording } from '@/lib/twilio-voice';
import { silentWav } from '@/lib/crm-voice-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Audio de la grabación a través del server: las credenciales de Twilio nunca
 * llegan al navegador y la visibilidad del CRM se respeta.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const res = await callForSession((await ctx.params).id);
  if ('error' in res) return res.error === 'unauthorized' ? unauthorized() : notFound();
  const sid = res.call.recording_sid;
  if (!sid) return notFound();
  const headers = { 'cache-control': 'private, no-store', 'content-disposition': 'inline' };
  if (fakeVoiceAllowed() && sid.startsWith('REfake')) {
    return new Response(new Uint8Array(silentWav(1)), { headers: { ...headers, 'content-type': 'audio/wav' } });
  }
  const audio = await fetchRecording(sid);
  if (!audio?.body) return notFound();
  return new Response(audio.body, { headers: { ...headers, 'content-type': audio.headers.get('content-type') ?? 'audio/mpeg' } });
}
