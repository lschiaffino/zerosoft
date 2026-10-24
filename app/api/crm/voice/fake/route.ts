import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { fakeVoiceAllowed } from '@/lib/twilio-voice';
import { runFakeVoiceAction } from '@/lib/crm-voice-fake';
import { callView, summarizeIfReady } from '@/lib/crm-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  callId: z.string().min(1).max(64),
  action: z.enum(['connect', 'answer', 'hangup']),
  durationSec: z.number().int().min(0).max(36_000).optional(),
});

/** Solo con CRM_VOICE_FAKE: el dispositivo simulado del navegador reporta lo que haría Twilio. */
export async function POST(req: NextRequest) {
  if (!fakeVoiceAllowed()) return notFound();
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const call = await runFakeVoiceAction(user.id, realUserId(user), parsed.data.callId, parsed.data.action, parsed.data.durationSec);
  if (!call) return notFound();
  if (parsed.data.action === 'hangup') after(() => summarizeIfReady(call.id));
  return NextResponse.json({ call: callView(call), activityId: call.activity_id });
}
