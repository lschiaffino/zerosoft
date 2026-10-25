import { NextRequest, NextResponse } from 'next/server';
import { handleGithubAppWebhook } from '@/lib/track-github';
import { githubAppWebhookSecret } from '@/lib/track-github-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Webhook único de la GitHub App. Autenticado por X-Hub-Signature-256 con el secreto de la App. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const res = await handleGithubAppWebhook(
    githubAppWebhookSecret(),
    req.headers.get('x-github-event'),
    raw,
    req.headers.get('x-hub-signature-256'),
  );
  return NextResponse.json(res.body, { status: res.status });
}
