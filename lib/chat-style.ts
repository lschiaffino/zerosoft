/**
 * Estilo de los chats de WhatsApp (Inbox y Lines), por persona: "whatsapp"
 * (la cara de WhatsApp Web: fondo, burbujas con cola, verde) o "zerosoft"
 * (el mismo layout con los tokens de la app). Vive en users.chat_style; la
 * pantalla lo pone en data-chat-style del contenedor y el CSS hace el resto.
 * Server-only.
 */
import { getDb } from './db';

export const CHAT_STYLES = ['whatsapp', 'zerosoft'] as const;
export type ChatStyle = (typeof CHAT_STYLES)[number];

export function isChatStyle(v: unknown): v is ChatStyle {
  return typeof v === 'string' && (CHAT_STYLES as readonly string[]).includes(v);
}

export async function getChatStyle(userId: string): Promise<ChatStyle> {
  const row = (await getDb().prepare('SELECT chat_style FROM users WHERE id = ?').get(userId).catch(() => undefined)) as { chat_style?: string } | undefined;
  return isChatStyle(row?.chat_style) ? row.chat_style : 'whatsapp';
}

export async function setChatStyle(userId: string, style: ChatStyle): Promise<void> {
  await getDb().prepare('UPDATE users SET chat_style = ? WHERE id = ?').run(style, userId);
}
