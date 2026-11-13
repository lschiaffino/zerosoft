import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getChatDisplay, getChatStyle, isChatStyle, setChatDisplay, setChatStyle } from '@/lib/chat-style';
import { patchDisplay } from '@/lib/chat-display';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** Estilo y visualización de los chats de WhatsApp de la persona (Inbox y Lines). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const id = realUserId(user);
  return NextResponse.json({ style: await getChatStyle(id), display: await getChatDisplay(id) }, { headers: NO_STORE });
}

/**
 * { style?: 'whatsapp' | 'zerosoft', display?: { textSize?, density?, linkPreviews?, mediaSize?, bubbleWidth?, wallpaper?, groupAvatars? } }.
 * `display` es un cambio parcial: lo que no viene queda como estaba y lo que no es válido se ignora.
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { style?: unknown; display?: unknown } | null;
  const hasStyle = body?.style !== undefined;
  const hasDisplay = body?.display !== undefined;
  if (!body || (!hasStyle && !hasDisplay)) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  if (hasStyle && !isChatStyle(body.style)) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  if (hasDisplay && (!body.display || typeof body.display !== 'object' || Array.isArray(body.display))) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  }
  const id = realUserId(user);
  if (hasStyle && isChatStyle(body.style)) await setChatStyle(id, body.style);
  const display = hasDisplay ? await setChatDisplay(id, patchDisplay(await getChatDisplay(id), body.display)) : await getChatDisplay(id);
  return NextResponse.json({ style: await getChatStyle(id), display }, { headers: NO_STORE });
}
