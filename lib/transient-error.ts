/**
 * Webhooks de WhatsApp (Lines e Inbox): qué errores piden un reintento del proveedor. Server-only.
 */

/**
 * ¿Vale la pena que el proveedor reintente? Sí si falló la base o la red (algo pasajero); no si el evento tiene
 * una forma que no esperamos o choca con una regla de la base: reintentarlo daría lo mismo.
 */
export function transientError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string } } | null;
  const text = `${e?.name ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.message ?? ''}`;
  if (/CONSTRAINT|MISMATCH|SQLITE_ERROR|SQL_PARSE|SQL_INPUT|TypeError|RangeError|SyntaxError/i.test(text)) return false;
  return /Libsql|SQLITE_BUSY|SQLITE_LOCKED|database is locked|HRANA|SERVER_ERROR|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout|aborted|\b5\d\d\b/i.test(text);
}
