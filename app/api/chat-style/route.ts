import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getChatStyle, isChatStyle, setChatStyle } from '@/lib/chat-style';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** Estilo de los chats de WhatsApp de la persona (Inbox y Lines). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ style: await getChatStyle(realUserId(user)) }, { headers: NO_STORE });
}

/** { style: 'whatsapp' | 'zerosoft' } */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { style?: unknown } | null;
  if (!isChatStyle(body?.style)) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  await setChatStyle(realUserId(user), body.style);
  return NextResponse.json({ style: body.style }, { headers: NO_STORE });
}
