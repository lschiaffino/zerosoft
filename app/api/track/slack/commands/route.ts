import { NextResponse } from 'next/server';
import { handleSlackCommand, slackSigningSecret, verifySlackSignature } from '@/lib/track-slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Slash command `/track`. Slack firma el cuerpo (X-Slack-Signature). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 100_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (!verifySlackSignature(slackSigningSecret(), raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  return NextResponse.json(await handleSlackCommand(new URLSearchParams(raw)));
}
