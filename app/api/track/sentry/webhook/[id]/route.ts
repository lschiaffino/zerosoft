import { NextRequest, NextResponse } from 'next/server';
import { handleSentryWebhook } from '@/lib/track-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Webhook de la integración interna de Sentry (firmado con Sentry-Hook-Signature). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const res = await handleSentryWebhook(id, req.headers.get('sentry-hook-resource'), raw, req.headers.get('sentry-hook-signature'));
  return NextResponse.json(res.body, { status: res.status });
}
