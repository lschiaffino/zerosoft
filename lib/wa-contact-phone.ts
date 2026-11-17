/**
 * El teléfono que muestra la ficha de un chat 1:1 (Info. del contacto, en
 * Inbox y Lines), como WhatsApp. Puro: lo usan el servidor y los tests.
 *
 * - El teléfono guardado del chat, si es uno (8 a 15 dígitos).
 * - Un chat guardado por lid (el id anónimo de WhatsApp): el teléfono que la
 *   libreta conoce para ese lid (`lidPhone`, de phoneForLid en
 *   lib/wa-contacts.ts). Si no se conoce, nada: los dígitos del lid no son un
 *   teléfono y nunca se muestran.
 * - Un grupo no tiene teléfono.
 */
const PHONE = /^\d{8,15}$/;

const digitsOf = (raw: string | null | undefined) => String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');

export function contactPhone(o: { phone?: string | null; chatId: string; lidPhone?: string | null }): string {
  const chatId = String(o.chatId ?? '').trim().toLowerCase();
  if (chatId.endsWith('@g.us')) return '';
  const lid = chatId.endsWith('@lid');
  const saved = digitsOf(o.phone);
  // Con un chat por lid, lo guardado como "teléfono" puede ser el mismo lid: no cuenta.
  if (PHONE.test(saved) && !(lid && saved === digitsOf(chatId))) return saved;
  if (lid) {
    const known = digitsOf(o.lidPhone);
    return PHONE.test(known) ? known : '';
  }
  const fromId = digitsOf(chatId);
  return PHONE.test(fromId) ? fromId : '';
}

/**
 * Lo que la pantalla puede mostrar de un teléfono que llega del servidor:
 * solo dígitos. Uno enmascarado (Lines, personas que no ven los números:
 * "54 ••• 00") no se muestra.
 */
export function visiblePhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().replace(/^\+/, '');
  return PHONE.test(s) ? s : '';
}
