/**
 * Lines e Inbox: un envío con el mismo clientId (la pantalla reintenta porque
 * no le llegó la respuesta, o dos pedidos iguales casi a la vez) sale una sola
 * vez a WhatsApp. Lo ya guardado se busca en la base (índice único por chat y
 * clientId); lo que está saliendo en esta instancia se espera en vez de
 * mandarlo otra vez. Server-only.
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Corre `send` una sola vez por `key` a la vez en esta instancia: un segundo
 * pedido con la misma clave mientras el primero sigue espera su resultado y
 * corre `after` (que lee lo guardado) en vez de volver a mandar.
 */
export async function onceInFlight<T>(key: string | null, send: () => Promise<T>, after: () => Promise<T>): Promise<T> {
  if (!key) return send();
  const running = inFlight.get(key);
  if (running) {
    await running.catch(() => undefined);
    return after();
  }
  const p = send();
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    if (inFlight.get(key) === p) inFlight.delete(key);
  }
}

/** Para los tests. */
export function sendsInFlightOnServer(): number {
  return inFlight.size;
}
