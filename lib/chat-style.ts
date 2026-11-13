/**
 * Estilo de los chats de WhatsApp (Inbox y Lines), por persona: "whatsapp"
 * (la cara de WhatsApp Web: fondo, burbujas con cola, verde) o "zerosoft"
 * (el mismo layout con los tokens de la app). Vive en users.chat_style; la
 * pantalla lo pone en data-chat-style del contenedor y el CSS hace el resto.
 * Server-only.
 */
import { getDb } from './db';
import { cleanDisplay, type ChatDisplay } from './chat-display';

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

/** Visualización de los chats (lib/chat-display.ts), por persona. Sin guardar: los valores por defecto. */
export async function getChatDisplay(userId: string): Promise<ChatDisplay> {
  const row = (await getDb().prepare('SELECT chat_display FROM users WHERE id = ?').get(userId).catch(() => undefined)) as { chat_display?: string } | undefined;
  return cleanDisplay(row?.chat_display ?? '');
}

export async function setChatDisplay(userId: string, display: ChatDisplay): Promise<ChatDisplay> {
  const clean = cleanDisplay(display);
  await getDb().prepare('UPDATE users SET chat_display = ? WHERE id = ?').run(JSON.stringify(clean), userId);
  return clean;
}
