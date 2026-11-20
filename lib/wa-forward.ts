/**
 * Reenvíos de WhatsApp (Lines e Inbox). WhatsApp marca un mensaje reenviado con `contextInfo.isForwarded` y cuenta
 * cuántas veces se reenvió en `contextInfo.forwardingScore`: muestra "Reenviado" y, desde 5, "Reenviado muchas
 * veces". Al reenviar desde zerosoft la copia lleva el score del original + 1 (1 si el original no era un reenvío),
 * como el teléfono. Igual que el teléfono, reenviar un mensaje propio que no era un reenvío (score 0) no lleva la marca. El score se guarda en el meta del mensaje (`fwd`), en los que llegan y en los que mandamos.
 *
 * Sin dependencias de servidor: lo usan también las pantallas.
 */

/** Desde este score WhatsApp dice "Reenviado muchas veces". */
export const FORWARDED_MANY = 5;

/** Tope razonable (WhatsApp lo guarda como uint32; más de esto no cambia nada). */
const MAX_SCORE = 1000;

/** El mensaje original, cuando el gateway lo puede reenviar desde lo que tiene guardado (misma línea). */
export interface ForwardKey {
  id: string;
  remoteJid: string;
  fromMe: boolean;
}

/** La marca de reenvío que va al proveedor. Un envío normal no la lleva nunca. */
export interface ForwardFlag {
  score: number;
  key?: ForwardKey;
}

/** El score guardado en el meta de un mensaje (`fwd`), o 0. */
export function storedForwardScore(meta: unknown): number {
  const raw = meta && typeof meta === 'object' ? (meta as { fwd?: unknown }).fwd : undefined;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SCORE) : 0;
}

/**
 * El score de la copia: el del original + 1. Un original recibido y reenviado sin score conocido cuenta como 1. Un
 * mensaje propio con score 0 (escrito por uno, no reenviado) da 0: sale sin la marca, como desde el teléfono.
 */
export function nextForwardScore(original: { forwarded: boolean; meta?: unknown; fromMe?: boolean }): number {
  const stored = original.forwarded ? storedForwardScore(original.meta) : 0;
  const before = stored || (original.forwarded && !original.fromMe ? 1 : 0);
  if (original.fromMe && before === 0) return 0;
  return Math.min(before + 1, MAX_SCORE);
}

/** El score que vino de WhatsApp (contextInfo.forwardingScore), si es un número válido. */
export function forwardScoreOf(raw: unknown): number | undefined {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SCORE) : undefined;
}

/** "Reenviado muchas veces": reenviado y con score >= 5. */
export function forwardedMany(forwarded: boolean, meta: unknown): boolean {
  return forwarded && storedForwardScore(meta) >= FORWARDED_MANY;
}

/**
 * El campo `forward` del pedido a Evolution (sendText, sendMedia, sendWhatsAppAudio, sendSticker). Nuestro gateway
 * (infra/evolution, parche 0013) lo pasa a Baileys; un Evolution sin el parche ignora el campo (la validación de
 * Evolution no rechaza campos de más) y el mensaje sale como antes, sin la marca.
 */
export function evolutionForward(flag: ForwardFlag | undefined): { forward?: { score: number; key?: ForwardKey } } {
  if (!flag) return {};
  const score = forwardScoreOf(flag.score) ?? 1;
  return { forward: { score, ...(flag.key?.id ? { key: { id: flag.key.id, remoteJid: flag.key.remoteJid, fromMe: flag.key.fromMe } } : {}) } };
}
