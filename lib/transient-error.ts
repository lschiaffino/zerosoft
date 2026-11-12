/**
 * Webhooks de WhatsApp (Lines e Inbox): qué errores piden un reintento del proveedor. Server-only.
 */

/**
 * ¿Vale la pena que el proveedor reintente? Sí si falló la base o la red (algo pasajero); no si el evento tiene
 * una forma que no esperamos o choca con una regla de la base: reintentarlo daría lo mismo.
 */
export function transientError(err: unknown): boolean {
  // Primero la causa (y la causa de la causa): libsql por HTTP falla como TypeError('fetch failed') con la causa de
  // red adentro (ECONNRESET, ETIMEDOUT…). Eso es pasajero aunque el error de afuera sea un TypeError.
  for (let e = err as Cause | null | undefined, depth = 0; e && depth < 5; e = e.cause as Cause | null | undefined, depth++) {
    if (NETWORK_CODE.test(`${e.code ?? ''} ${e.errno ?? ''}`)) return true;
  }
  const e = err as Cause | null;
  const text = `${e?.name ?? ''} ${e?.code ?? ''} ${e?.message ?? ''}`;
  // Permanentes: reintentar da lo mismo (una regla de la base, un tipo o un tamaño que no entra, SQL inválido, una forma
  // que no esperamos).
  if (/CONSTRAINT|MISMATCH|TOOBIG|SQLITE_RANGE|SQLITE_ERROR|SQLITE_MISUSE|SQL_PARSE|SQL_INPUT|ARGS_INVALID|TypeError|RangeError|SyntaxError/i.test(text)) return false;
  return /Libsql|SQLITE_BUSY|SQLITE_LOCKED|SQLITE_IOERR|database is locked|HRANA|SERVER_ERROR|fetch failed|socket hang up|network|timeout|aborted|\b5\d\d\b/i.test(text);
}

interface Cause {
  name?: string;
  code?: string;
  errno?: string | number;
  message?: string;
  cause?: unknown;
}

const NETWORK_CODE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/;
