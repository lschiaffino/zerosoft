/**
 * Lo que comparten las rutas de GIFs de Lines (app/api/groups/gifs) e Inbox
 * (app/api/inbox/gifs): buscar (proxy al proveedor, con la clave del lado del
 * servidor y un límite por persona) y bajar el elegido. Cada ruta pone su
 * sesión y cómo se manda. Server-only.
 */
import { NextResponse } from 'next/server';
import { rateLimit } from './rate-limit';
import { downloadGif, gifChoice, GifError, listGifs } from './wa-gifs';

/** Búsquedas por persona y minuto (escribir dispara una por pausa; con la caché, de sobra). */
const SEARCH_LIMIT = 60;
/** GIFs mandados por persona y minuto. */
const SEND_LIMIT = 20;

/** La cookie wa_gifs_fake=off muestra el estado sin clave (solo cuenta con el buscador falso). */
export function fakeOff(req: Request): boolean {
  return /(?:^|;\s*)wa_gifs_fake=off(?:;|$)/.test(req.headers.get('cookie') ?? '');
}

async function limited(key: string, limit: number): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return false;
  return !(await rateLimit(key, limit, 60)).ok;
}

/** GET ?q=&pos=&locale=: { provider, items, next }; provider null si no hay clave. */
export async function gifsResponse(req: Request, user: string): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  if (await limited(`wa-gifs:${user}`, SEARCH_LIMIT)) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '30' } });
  try {
    const page = await listGifs({ q: sp.get('q') ?? '', pos: sp.get('pos') ?? '', locale: sp.get('locale') ?? 'en', fakeOff: fakeOff(req) });
    // La caché es la del servidor (lib/wa-gifs.ts, unos minutos): el navegador no guarda, así una clave nueva se ve al momento.
    return NextResponse.json(page, { headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    return gifError(err);
  }
}

/** El MP4 del GIF elegido ({ url, width?, height? } del buscador), bajado y validado. */
export async function chosenGif(req: Request, user: string, b: Record<string, unknown>): Promise<{ data: Buffer; width?: number; height?: number }> {
  if (await limited(`wa-gifs-send:${user}`, SEND_LIMIT)) throw new GifError('rate_limited', 429);
  const choice = gifChoice(b);
  const data = await downloadGif(choice.url, { fakeOff: fakeOff(req) });
  return { data, ...(choice.width && choice.height ? { width: choice.width, height: choice.height } : {}) };
}

export function gifError(err: unknown): NextResponse {
  if (err instanceof GifError) return NextResponse.json({ error: err.code }, { status: err.status });
  throw err;
}
