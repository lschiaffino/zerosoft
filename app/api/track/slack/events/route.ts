import { NextResponse } from 'next/server';
import { handleSlackEvent, slackSigningSecret, verifySlackSignature } from '@/lib/track-slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Events API de Slack: verificación de URL, link_shared (unfurl) y respuestas en hilos sincronizados. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (!verifySlackSignature(slackSigningSecret(), raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  // Slack reintenta si no respondemos en 3 s; un reintento no se procesa dos veces.
  if (req.headers.get('x-slack-retry-num')) return new NextResponse(null, { status: 200 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const out = await handleSlackEvent(body as Parameters<typeof handleSlackEvent>[0]);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 200 });
}
