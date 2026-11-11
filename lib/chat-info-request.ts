/**
 * "Info del contacto" desde el menú de una fila de Lines: la lista pide el
 * panel de detalles de un chat y la conversación lo abre, ya sea que esté a
 * la vista (aviso) o que se monte después de navegar (pedido pendiente).
 * Cliente.
 */

export const CHAT_INFO_EVENT = 'zerosoft:chat-info';

let pending: string | null = null;

export function requestChatInfo(id: string) {
  pending = id;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHAT_INFO_EVENT, { detail: id }));
}

/** ¿Hay un pedido para este chat? Lo consume (una sola vez). */
export function takeChatInfo(id: string): boolean {
  if (pending !== id) return false;
  pending = null;
  return true;
}
