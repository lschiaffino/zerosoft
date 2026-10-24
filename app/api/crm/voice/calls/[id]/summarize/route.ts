import { NextRequest, NextResponse } from 'next/server';
import { crmError, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { callForSession } from '@/lib/crm-voice-http';
import { callView, summarizeCall } from '@/lib/crm-voice';
import { realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Resume (o vuelve a resumir) la transcripción con IA. El error de IA vuelve en summaryStatus. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const res = await callForSession((await ctx.params).id);
  if ('error' in res) return res.error === 'unauthorized' ? unauthorized() : notFound();
  if (!res.call.transcript.trim()) return crmError(400, 'no_transcript');
  const limited = await limitAction(realUserId(res.user), 'voice-summary', 30, 3600);
  if (limited) return limited;
  const call = await summarizeCall(res.user.id, res.call.id);
  if (!call) return notFound();
  const view = callView(call);
  if (view.summaryStatus !== 'done') {
    return NextResponse.json({ error: view.summaryStatus, call: view }, { status: view.summaryStatus === 'ai_disabled' ? 503 : 502 });
  }
  return NextResponse.json({ call: view });
}
