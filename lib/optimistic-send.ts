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

/** Dónde quedan, en la pestaña, los textos de Lines que no salieron y los borradores de Lines (se borran al salir). */
export const UNSENT_LINES_KEY = 'zs:lines-unsent';
export const LINES_DRAFT_PREFIX = 'gr-draft:';

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

// ---------- Una cola por chat, fuera de los componentes ----------

const queues = new Map<string, ReturnType<typeof sendQueue>>();
let inFlight = 0;

function warnOnLeave(e: BeforeUnloadEvent) {
  // Hay envíos saliendo: cerrar o recargar ahora los puede cortar. El navegador muestra su aviso de siempre.
  e.preventDefault();
  e.returnValue = '';
}

/** Envíos encolados o saliendo en esta pestaña (para los tests y para el aviso al cerrar). */
export function sendsInFlight(): number {
  return inFlight;
}

/**
 * La cola de envíos de un chat (`key`: app y chat). Vive fuera del componente:
 * el orden se mantiene aunque el chat se cierre y se vuelva a abrir, y todo lo
 * que se manda a ese chat (texto, archivos, notas de voz, notas) pasa por la
 * misma cola, así un archivo no se adelanta a un texto que todavía está
 * saliendo. Mientras haya algo saliendo, cerrar la pestaña pide confirmación.
 */
export function sendQueueFor(key: string): <T>(job: () => Promise<T>) => Promise<T> {
  let q = queues.get(key);
  if (!q) {
    q = sendQueue();
    queues.set(key, q);
  }
  const run = q;
  return <T>(job: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    if (inFlight === 1 && typeof window !== 'undefined') window.addEventListener('beforeunload', warnOnLeave);
    const done = () => {
      inFlight -= 1;
      if (inFlight === 0 && typeof window !== 'undefined') window.removeEventListener('beforeunload', warnOnLeave);
    };
    const p = run(job);
    p.then(done, done);
    return p;
  };
}

// ---------- Lo que todavía no salió, por chat ----------

/** Qué tipo de archivo es, por su mimetype (como lo manda la pantalla). */
export type UnsentMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

export function mediaKindOf(type: string): UnsentMediaKind {
  return type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'document';
}

/**
 * El archivo de un envío que todavía no está guardado (foto, video, nota de voz, documento, sticker). Mientras se
 * sube, la burbuja muestra la copia local (`localPreviews`); `url` aparece cuando la subida terminó, y desde ahí un
 * reintento manda lo ya subido sin volver a subirlo.
 */
export interface UnsentMedia {
  kind: UnsentMediaKind;
  name: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  /** Ya subido: lo que se manda. Sin esto, el archivo está solo en esta pestaña (no sobrevive a una recarga). */
  url?: string;
}

/** Un mensaje que se mandó y todavía no está guardado en el servidor: saliendo, o no salió. */
export interface Unsent {
  clientId: string;
  /** Quién lo escribió: otra persona que entre en la misma pestaña no lo ve ni lo puede mandar. */
  owner: string;
  chatId: string;
  body: string;
  replyToId: string | null;
  /** Grupos de WhatsApp: teléfonos mencionados con "@<teléfono>" en el texto. */
  mentions?: string[];
  status: 'pending' | 'failed';
  error: string;
  createdAt: string;
  /** La persona sacó la vista previa del link antes de mandar: sale sin ella (también al reintentar). */
  noPreview?: boolean;
  /** Un archivo (con `body` como su pie). */
  media?: UnsentMedia;
}

export type UnsentEvent<S> = { chatId: string; entry: Unsent; type: 'added' | 'pending' | 'failed' | 'removed' } | { chatId: string; entry: Unsent; type: 'saved'; saved: S };

/**
 * Lo que no salió, guardado fuera del componente del chat y en sessionStorage:
 * si el envío falla cuando la persona ya abrió otro chat (o recargó la
 * página), el texto no se pierde: al volver al chat está ahí, como no enviado,
 * con reintentar. Al recargar, lo que estaba "saliendo" queda como no enviado
 * (no se sabe si salió): si el servidor ya lo tiene, el chat lo reconoce por
 * su clientId y lo saca.
 */
export function unsentStore<S>(storageKey: string) {
  let items: Unsent[] | null = null;
  /** La persona de la sesión. Lo de otra persona no se muestra y se descarta. '' = todavía no se sabe: no se muestra nada. */
  let owner = '';
  const listeners = new Set<(e: UnsentEvent<S>) => void>();
  const load = (): Unsent[] => {
    if (items) return items;
    items = [];
    try {
      const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(storageKey) : null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        items = parsed
          .filter(
            (x): x is Unsent =>
              !!x && typeof x === 'object' && !!cleanClientId((x as Unsent).clientId) && typeof (x as Unsent).owner === 'string' && typeof (x as Unsent).chatId === 'string' && typeof (x as Unsent).body === 'string',
          )
          .slice(-200)
          // Un archivo que no terminó de subirse vivía solo en la pestaña: después de recargar no hay nada que mandar.
          .filter((x) => !x.media || !!x.media.url)
          // Lo que estaba saliendo cuando se recargó la página: ya nadie lo está mandando.
          .map((x) => ({ ...x, replyToId: x.replyToId ?? null, createdAt: x.createdAt || new Date().toISOString(), ...(x.status === 'failed' ? { error: x.error || 'send_failed' } : { status: 'failed' as const, error: 'interrupted' }) }));
      }
    } catch {
      /* sin sessionStorage, o roto: se sigue en memoria */
    }
    return items;
  };
  const save = () => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (items?.length) sessionStorage.setItem(storageKey, JSON.stringify(items));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* cuota o modo privado: queda en memoria */
    }
  };
  /** Los que tienen un pedido en curso en esta pestaña (no se mandan otra vez hasta que termine). */
  const inFlightIds = new Set<string>();
  const emit = (e: UnsentEvent<S>) => {
    for (const fn of [...listeners]) fn(e);
  };
  const find = (clientId: string) => load().find((x) => x.clientId === clientId && !!owner && x.owner === owner);
  const drop = (clientId: string) => {
    items = load().filter((x) => x.clientId !== clientId);
    save();
  };
  return {
    /**
     * Quién usa la pestaña ahora (la persona de la sesión). Lo que quedó de otra persona se descarta: nunca se
     * muestra ni se manda a nombre de otro.
     */
    setOwner(id: string): void {
      owner = id;
      const before = load().length;
      items = load().filter((x) => x.owner === id);
      if (items.length !== before) save();
    },
    list: (chatId: string): Unsent[] => (owner ? load().filter((x) => x.chatId === chatId && x.owner === owner) : []),
    get: find,
    add(input: { chatId: string; body: string; replyToId: string | null; noPreview?: boolean; mentions?: string[]; media?: UnsentMedia }): Unsent {
      const { media, ...rest } = input;
      const entry: Unsent = { ...rest, ...(media ? { media } : {}), owner, clientId: newClientId(), status: 'pending', error: '', createdAt: new Date().toISOString() };
      load().push(entry);
      save();
      emit({ chatId: entry.chatId, entry, type: 'added' });
      return entry;
    },
    /**
     * Vuelve a salir (reintento): la misma burbuja, otra vez "enviando". undefined si ya está saliendo (dos clics en
     * reintentar no mandan dos pedidos) o no es de esta persona.
     */
    pending(clientId: string): Unsent | undefined {
      const entry = find(clientId);
      if (!entry || inFlightIds.has(clientId)) return undefined;
      inFlightIds.add(clientId);
      entry.status = 'pending';
      entry.error = '';
      save();
      emit({ chatId: entry.chatId, entry, type: 'pending' });
      return entry;
    },
    fail(clientId: string, error: string): void {
      inFlightIds.delete(clientId);
      const entry = find(clientId);
      if (!entry) return;
      entry.status = 'failed';
      entry.error = error || 'send_failed';
      save();
      emit({ chatId: entry.chatId, entry, type: 'failed' });
    },
    /** El servidor lo guardó: sale de acá y quien mira recibe el mensaje guardado. */
    saved(clientId: string, saved: S): void {
      inFlightIds.delete(clientId);
      const entry = find(clientId);
      if (!entry) return;
      drop(clientId);
      emit({ chatId: entry.chatId, entry, type: 'saved', saved });
    },
    /** El archivo de un envío terminó de subirse (o se supo su tamaño): queda guardado para un reintento. */
    setMedia(clientId: string, patch: Partial<UnsentMedia>): void {
      const entry = find(clientId);
      if (!entry?.media) return;
      entry.media = { ...entry.media, ...patch };
      save();
    },
    /** Se quita (la persona lo descartó, o el chat ya trae su mensaje guardado). */
    remove(clientId: string): void {
      inFlightIds.delete(clientId);
      const entry = find(clientId);
      if (!entry) return;
      drop(clientId);
      emit({ chatId: entry.chatId, entry, type: 'removed' });
    },
    subscribe(fn: (e: UnsentEvent<S>) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

// ---------- Archivos: la copia local y el avance de la subida ----------

/**
 * La copia local (object URL) de cada archivo que se manda, por clientId: la
 * burbuja la muestra al instante y la sigue mostrando cuando la reemplaza el
 * mensaje guardado (mismo archivo, sin parpadeo). Se libera cuando ya no hace
 * falta: una foto, apenas su copia del servidor terminó de cargar; el resto,
 * al cerrar el chat (un audio que suena no se corta a mitad).
 */
const previews = new Map<string, { url: string; scope: string; kind: string; settled: boolean }>();

export const localPreviews = {
  set(clientId: string, url: string, scope: string, kind: string): void {
    const old = previews.get(clientId);
    if (old && old.url !== url) revoke(old.url);
    previews.set(clientId, { url, scope, kind, settled: false });
  },
  get: (clientId: string | undefined): string | undefined => (clientId ? previews.get(clientId)?.url : undefined),
  /** Ya no hace falta (se descartó el envío). */
  release(clientId: string): void {
    const p = previews.get(clientId);
    if (!p) return;
    previews.delete(clientId);
    revoke(p.url);
  },
  /**
   * El mensaje ya está guardado. Una foto o un sticker: se baja la del servidor y, ya en caché, se suelta la local (el
   * cambio no se nota). Lo demás queda hasta `releaseScope` (cerrar el chat).
   */
  settle(clientId: string, remoteUrl: string | undefined): void {
    const p = previews.get(clientId);
    if (!p) return;
    p.settled = true;
    if ((p.kind !== 'image' && p.kind !== 'sticker') || !remoteUrl || typeof Image === 'undefined') return;
    const img = new Image();
    const done = () => previews.get(clientId) === p && localPreviews.release(clientId);
    img.onload = done;
    img.onerror = done;
    img.src = remoteUrl;
  },
  /** Se cerró el chat: lo ya guardado de ese chat suelta su copia local. Lo que sigue saliendo la conserva. */
  releaseScope(scope: string): void {
    for (const [cid, p] of [...previews]) if (p.scope === scope && p.settled) localPreviews.release(cid);
  },
};

function revoke(url: string) {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

const progress = new Map<string, number>();
const progressListeners = new Set<() => void>();

/** Cuánto se subió de cada archivo que se está mandando (0 a 1), por clientId: el anillo de la burbuja. */
export const uploadProgress = {
  get: (clientId: string | undefined): number | undefined => (clientId ? progress.get(clientId) : undefined),
  set(clientId: string, p: number): void {
    const v = Math.max(0, Math.min(1, p));
    if (progress.get(clientId) === v) return;
    progress.set(clientId, v);
    for (const fn of [...progressListeners]) fn();
  },
  clear(clientId: string): void {
    if (!progress.delete(clientId)) return;
    for (const fn of [...progressListeners]) fn();
  },
  subscribe(fn: () => void): () => void {
    progressListeners.add(fn);
    return () => {
      progressListeners.delete(fn);
    };
  },
};
