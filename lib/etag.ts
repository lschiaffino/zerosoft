/**
 * Respuestas condicionales para lo que la pantalla consulta cada pocos
 * segundos (listas, contadores, el chat abierto): la respuesta lleva un ETag
 * de su contenido y, si el pedido trae el mismo en If-None-Match, sale 304
 * sin cuerpo. Quien pregunta no vuelve a parsear ni a dibujar nada.
 * Server-only.
 */
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

export function etagOf(body: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`;
}

export function etagMatches(req: Request, etag: string): boolean {
  const sent = req.headers.get('if-none-match');
  if (!sent) return false;
  return sent.split(',').some((v) => v.trim() === etag);
}

/** JSON con ETag, o 304 si quien pide ya tiene este contenido. */
export function conditionalJson<T>(req: Request, body: T, headers: Record<string, string> = {}): NextResponse {
  const etag = etagOf(body);
  if (etagMatches(req, etag)) return new NextResponse(null, { status: 304, headers: { ...headers, etag } });
  return NextResponse.json(body, { status: 200, headers: { ...headers, etag } });
}
