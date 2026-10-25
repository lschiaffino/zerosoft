import { NextResponse } from 'next/server';
import { handleSlackInteraction, slackSigningSecret, verifySlackSignature } from '@/lib/track-slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Atajos de mensaje y envío de modales (Interactivity de Slack). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (!verifySlackSignature(slackSigningSecret(), raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const out = await handleSlackInteraction(payload as Parameters<typeof handleSlackInteraction>[0]);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 200 });
}
