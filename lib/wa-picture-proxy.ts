/**
 * Fotos de perfil de WhatsApp (contactos de la libreta de Inbox y Lines): la
 * URL de la CDN de WhatsApp nunca llega al navegador. La ruta que ya chequeó
 * el acceso la baja acá y la pasa como imagen. Server-only.
 */
import { NextResponse } from 'next/server';
import { safeFetch } from './safe-fetch';

/** Solo la CDN de WhatsApp (nada de URLs arbitrarias). */
const WA_CDN = /(^|\.)whatsapp\.net$/i;
const MAX = 2 * 1024 * 1024;

export function isWaPictureUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && WA_CDN.test(u.hostname);
  } catch {
    return false;
  }
}

/** La imagen, o null si no es de la CDN, no está o no es una imagen chica. */
export async function waPictureResponse(raw: string): Promise<Response | null> {
  if (!isWaPictureUrl(raw)) return null;
  const res = await safeFetch(raw, {}, 8_000).catch(() => null);
  if (!res?.ok || !res.body) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(type) || Number(res.headers.get('content-length') ?? 0) > MAX) {
    await res.body.cancel().catch(() => undefined);
    return null;
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX) return null;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

