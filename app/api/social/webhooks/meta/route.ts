import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { claimWebhookEvent, handleMetaWebhook, releaseWebhookEvent, verifyMetaChallenge, verifyMetaWebhook } from '@/lib/social-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de la app de Meta de la instancia (páginas e Instagram): uno solo
 * para todos los workspaces. GET es la verificación de la suscripción
 * (META_WEBHOOK_VERIFY_TOKEN); POST trae comentarios y mensajes, firmados con
 * el app secret (X-Hub-Signature-256). Sin firma válida no se lee nada.
 */
export async function GET(req: NextRequest) {
  const challenge = verifyMetaChallenge(req.nextUrl.searchParams);
  if (challenge === null) return new NextResponse('forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  if (!verifyMetaWebhook(raw, req.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // Meta reintenta el mismo cuerpo: se procesa una vez. Si procesar falla, se libera y se responde 500 para que Meta reintente.
  // Una página conectada en dos workspaces recibe el ítem en las dos bandejas (cada una con su fila).
  const key = `meta:${createHash('sha256').update(raw).digest('hex')}`;
  if (!(await claimWebhookEvent(key))) return NextResponse.json({ ok: true, duplicate: true });
  try {
    const added = await handleMetaWebhook(body);
    return NextResponse.json({ ok: true, added });
  } catch {
    await releaseWebhookEvent(key);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
