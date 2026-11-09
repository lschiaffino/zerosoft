import { after, NextRequest, NextResponse } from 'next/server';
import { handleLinearWebhook } from '@/lib/track-linear-sync';
import { runOutboxItem } from '@/lib/track-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY = 512 * 1024;

/**
 * Webhooks de Linear (la app OAuth y los webhooks que crea una conexión por
 * API key). Firma verificada con el cuerpo crudo (header linear-signature) y
 * webhookTimestamp a menos de un minuto; lo que llega se encola y se trae de
 * la API después de responder (Linear espera respuesta rápida).
 */
export async function POST(req: NextRequest) {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  // Leído por partes: un cuerpo sin content-length tampoco pasa del tope.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return NextResponse.json({ error: 'too_large' }, { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const outcome = await handleLinearWebhook(raw, req.headers.get('linear-signature'));
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.status === 401 ? 'invalid_signature' : 'invalid_payload' }, { status: outcome.status });
  const ids = outcome.queued.map((q) => q.outboxId).filter((x): x is string => !!x);
  if (ids.length) {
    const job = async () => {
      for (const id of ids) await runOutboxItem(id);
    };
    try {
      after(job);
    } catch {
      void job();
    }
  }
  return NextResponse.json({ ok: true });
}
