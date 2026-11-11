/**
 * Borradores de chat al instante, como WhatsApp: lo que se escribe en el
 * composer llega a la fila de la lista en el mismo momento ("Borrador: …"),
 * y borrarlo saca la etiqueta en el mismo momento. Guardar en el servidor va
 * por detrás; mientras tanto (y un rato después, hasta que la lista que llega
 * por la consulta periódica lo confirme) manda lo local, así la fila no
 * parpadea con un valor viejo.
 *
 * El estado vive en el módulo (uno por pestaña) y se lee con
 * `useSyncExternalStore` (components/ui/useDraft.ts). `pickDraft` es puro.
 */

export interface LocalDraft {
  text: string;
  /** Todavía no se guardó (o se está guardando). */
  pending: boolean;
  /** Cuándo terminó de guardarse (ms); 0 si no terminó. */
  savedAt: number;
}

/** Después de guardado, cuánto (ms) manda lo local si la lista todavía trae otro valor (una consulta que salió antes de guardar). */
export const DRAFT_TRUST_MS = 15_000;

/**
 * Qué borrador mostrar: el local mientras no se guardó, o si se guardó hace
 * poco y el servidor todavía no lo refleja; si no, el del servidor (puede
 * haberlo cambiado otra pestaña o el teléfono).
 */
export function pickDraft(local: LocalDraft | undefined, server: string, now: number): string {
  if (!local) return server;
  if (local.pending) return local.text;
  if (local.text === server) return server;
  return now - local.savedAt < DRAFT_TRUST_MS ? local.text : server;
}

/** ¿Ya no hace falta lo local? (el servidor lo confirmó, o pasó el tiempo de gracia). */
export function settled(local: LocalDraft, server: string, now: number): boolean {
  return !local.pending && (local.text === server || now - local.savedAt >= DRAFT_TRUST_MS);
}

const drafts = new Map<string, LocalDraft>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (scope: string, id: string) => `${scope}:${id}`;

function emit() {
  version++;
  for (const l of listeners) l();
}

export function subscribeDrafts(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function draftsVersion(): number {
  return version;
}

export function localDraft(scope: string, id: string): LocalDraft | undefined {
  return drafts.get(keyOf(scope, id));
}

/** Se escribió (o se borró) en el composer: la lista lo ve ya. */
export function typeDraft(scope: string, id: string, text: string) {
  const k = keyOf(scope, id);
  const cur = drafts.get(k);
  if (cur && cur.pending && cur.text === text) return;
  drafts.set(k, { text, pending: true, savedAt: 0 });
  emit();
}

/** El servidor guardó `text` (si mientras tanto se escribió otra cosa, sigue pendiente). */
export function savedDraft(scope: string, id: string, text: string, now = Date.now()) {
  const k = keyOf(scope, id);
  const cur = drafts.get(k);
  if (!cur || cur.text !== text) return;
  drafts.set(k, { text, pending: false, savedAt: now });
  emit();
}

/** El servidor ya tiene `text` por otro camino (mandar el mensaje borra el borrador): la fila lo muestra ya, aunque la lista llegue atrasada. */
export function knownDraft(scope: string, id: string, text: string, now = Date.now()) {
  drafts.set(keyOf(scope, id), { text, pending: false, savedAt: now });
  emit();
}

/** Lo local ya no hace falta: la fila vuelve a mostrar lo del servidor. */
export function forgetDraft(scope: string, id: string) {
  if (drafts.delete(keyOf(scope, id))) emit();
}

/** Solo para tests. */
export function resetDrafts() {
  drafts.clear();
  emit();
}
