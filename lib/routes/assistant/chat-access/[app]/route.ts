import { NextResponse } from 'next/server';
import { assistantUser, owner } from '@/lib/assistant/http';
import { CHAT_APPS, revokeChatAccess, type ChatApp } from '@/lib/assistant/chat-access';
import { audit } from '@/lib/assistant/store';

export const dynamic = 'force-dynamic';

/**
 * Ajustes › Cuenta › Acceso del asistente: sacar el permiso de leer los chats
 * de una app (el de siempre y los de cada charla). Solo los de la persona.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ app: string }> }) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { app } = await params;
  if (!(CHAT_APPS as readonly string[]).includes(app)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const who = owner(user);
  await revokeChatAccess(who, app as ChatApp);
  await audit({ owner: who, conversationId: null, tool: 'grant_chat_access', kind: 'cancel', input: { app }, outcome: 'revoked' });
  return NextResponse.json({ ok: true });
}
