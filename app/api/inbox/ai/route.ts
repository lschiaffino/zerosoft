import { NextResponse } from 'next/server';
import { inboxAiState, inboxAiStream, inboxAiText } from '@/lib/inbox/ai';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { aiSchema } from '@/lib/inbox/schemas';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** ¿Hay IA configurada? La pantalla lo avisa antes de pedir. */
export async function GET() {
  return withOwner(async () => iJson({ state: inboxAiState() }));
}

/**
 * Borrador de respuesta o reescritura. Nunca manda: devuelve el texto para el
 * campo. Con `stream: true` responde texto plano que llega de a pedazos.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-ai', 60, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const { stream, ...ask } = await parseBody(req, aiSchema);
    if (!stream) return iJson({ text: await inboxAiText(owner, ask) });
    const out = await inboxAiStream(owner, ask);
    return new NextResponse(out, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store', 'x-accel-buffering': 'no' },
    });
  });
}
