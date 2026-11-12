/**
 * Lines, "Chat nuevo": el teléfono que alguien escribe a mano. Sin imports de
 * servidor: lo usan el diálogo (para ofrecer "Escribirle a +N") y la API.
 */

export type NewChatPhoneError = 'not_a_phone' | 'too_short' | 'too_long';

export type NewChatPhone = { ok: true; phone: string } | { ok: false; error: NewChatPhoneError };

/** Largo de un número con código de país (E.164 sin "+"). */
export const NEW_CHAT_PHONE_MIN = 8;
export const NEW_CHAT_PHONE_MAX = 15;

/** ¿Es algo que se escribe como teléfono? Dígitos con espacios, guiones, puntos, paréntesis y un "+" adelante. */
export function looksLikePhone(raw: string): boolean {
  const s = String(raw ?? '').trim();
  return /^\+?[\d\s().-]+$/.test(s) && /\d/.test(s);
}

/**
 * "+54 9 (11) 5555-0000" → "5491155550000". Acepta espacios, guiones, puntos,
 * paréntesis, un "+" adelante y el prefijo internacional "00". Con letras u
 * otros símbolos no es un teléfono; fuera de 8 a 15 dígitos, tampoco.
 */
export function parseNewChatPhone(raw: string): NewChatPhone {
  const s = String(raw ?? '').trim();
  if (!looksLikePhone(s)) return { ok: false, error: 'not_a_phone' };
  let digits = s.replace(/\D/g, '');
  if (!s.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < NEW_CHAT_PHONE_MIN) return { ok: false, error: 'too_short' };
  if (digits.length > NEW_CHAT_PHONE_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, phone: digits };
}
