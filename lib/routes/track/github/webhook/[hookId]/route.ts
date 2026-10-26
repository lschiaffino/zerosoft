import { NextRequest, NextResponse } from 'next/server';
import { handleGithubWebhook } from '@/lib/track-github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Webhook de GitHub (pull_request, push). Autenticado por X-Hub-Signature-256. */
export async function POST(req: NextRequest, props: { params: Promise<{ hookId: string }> }) {
  const { hookId } = await props.params;
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const res = await handleGithubWebhook(
    hookId,
    req.headers.get('x-github-event'),
    raw,
    req.headers.get('x-hub-signature-256'),
  );
  return NextResponse.json(res.body, { status: res.status });
}
