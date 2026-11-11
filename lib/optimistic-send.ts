/**
 * Lines e Inbox: el mensaje que se manda aparece en el chat al apretar Enter,
 * sin esperar al servidor. Lógica pura (sin React), compartida por los dos:
 *
 *   enviando  →  enviado    (la respuesta del servidor reemplaza la burbuja)
 *            ↘  no enviado  (queda en el chat con su error; se puede reintentar o descartar)
 *
 * Cada burbuja provisoria lleva un `clientId` que viaja con el envío y vuelve
 * en el mensaje guardado (meta.cid): si el mensaje real llega antes por el
 * aviso en vivo que por la respuesta del envío, la provisoria se va y no se
 * ve dos veces. Los envíos de un chat salen de a uno y en orden.
 */

export const TEMP_PREFIX = 'tmp-';

export const isTempId = (id: string): boolean => id.startsWith(TEMP_PREFIX);

/** Un id para el envío: único en esta pestaña y fácil de validar en el servidor. */
export function newClientId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return rnd.replace(/[^\w-]/g, '').slice(0, 40);
}

/** Lo que el servidor acepta como clientId (y nada más queda guardado). */
export function cleanClientId(v: unknown): string | undefined {
  return typeof v === 'string' && /^[\w-]{8,40}$/.test(v) ? v : undefined;
}

export const tempIdFor = (clientId: string): string => `${TEMP_PREFIX}${clientId}`;

/** Lo mínimo que la lógica mira de un mensaje (los de Lines y los de Inbox lo cumplen). */
export interface Sendable {
  id: string;
  /** El clientId con el que se mandó, si lo tiene (provisoria o ya guardada). */
  cid?: string;
}

/**
 * Suma lo que llegó del servidor a lo que hay en pantalla: una provisoria cuyo
 * mensaje real ya está en `incoming` se va (la reemplaza el real); las demás
 * provisorias quedan. `cidOf` dice con qué clientId se mandó un mensaje.
 */
export function dropSettled<M extends { id: string }>(shown: M[], incoming: M[], cidOf: (m: M) => string | undefined): M[] {
  const arrived = new Set<string>();
  for (const m of incoming) {
    const cid = isTempId(m.id) ? undefined : cidOf(m);
    if (cid) arrived.add(cid);
  }
  if (!arrived.size) return shown;
  return shown.filter((m) => !(isTempId(m.id) && arrived.has(m.id.slice(TEMP_PREFIX.length))));
}

/**
 * Cola de envíos de un chat: de a uno y en orden (el segundo mensaje no sale
 * hasta que el primero terminó, bien o mal). Un envío que falla no frena a los
 * que siguen.
 */
export function sendQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
