import { NextRequest, NextResponse } from 'next/server';
import { handleNotionWebhook } from '@/lib/notion-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhooks de la integración pública de Notion. Firmados con el token de
 * verificación (X-Notion-Signature); solo avisan que algo cambió: la
 * sincronización vuelve a leer todo de la API.
 */
export async function POST(req: NextRequest) {
  // Tope antes de leer el cuerpo (los eventos de Notion pesan unos pocos KB).
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 256 * 1024) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const raw = await req.text();
  const res = await handleNotionWebhook(raw, req.headers.get('x-notion-signature'));
  return NextResponse.json(res.body, { status: res.status });
}
