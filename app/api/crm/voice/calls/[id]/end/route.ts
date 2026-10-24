import { after, NextRequest, NextResponse } from 'next/server';
import { notFound, unauthorized } from '@/lib/crm-http';
import { callForSession } from '@/lib/crm-voice-http';
import { callView, finishCall, summarizeIfReady } from '@/lib/crm-voice';
import { childCallResult, fakeVoiceAllowed } from '@/lib/twilio-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Respaldo de la UI al cortar: si el webhook del <Dial> todavía no cerró la
 * llamada, se pregunta a Twilio por la llamada hija y se cierra acá. Cerrar
 * es idempotente (lib/crm-voice.ts), así que no se duplica la actividad.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const res = await callForSession((await ctx.params).id);
  if ('error' in res) return res.error === 'unauthorized' ? unauthorized() : notFound();
  let call = res.call;
  if (!call.ended_at && call.direction === 'outbound') {
    const child = call.call_sid && !fakeVoiceAllowed() ? await childCallResult(call.call_sid) : null;
    // Sin respuesta de Twilio todavía: si nunca conectó, se registra como no atendida.
    if (child && ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(child.status)) {
      call = (await finishCall(call.id, { status: child.status, durationSec: child.duration })) ?? call;
    } else if (!call.call_sid) {
      call = (await finishCall(call.id, { status: 'canceled', durationSec: 0 })) ?? call;
    }
  }
  after(() => summarizeIfReady(call.id));
  return NextResponse.json({ call: callView(call), activityId: call.activity_id });
}
