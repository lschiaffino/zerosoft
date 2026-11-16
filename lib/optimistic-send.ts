/**
 * Lines e Inbox: el mensaje que se manda aparece en el chat al apretar Enter,
 * sin esperar al servidor. Lógica pura (sin React), compartida por los dos:
 *
 *   enviando  →  enviado    (la respuesta del servidor reemplaza la burbuja)
 *            ↘  no enviado  (queda en el chat con su error; se puede reintentar o descartar)
 *   en cola (sin red) → enviando, solo, cuando vuelve la conexión (`offlineOutbox`)
 *
 * Cada burbuja provisoria lleva un `clientId` que viaja con el envío y vuelve
 * en el mensaje guardado (meta.cid): si el mensaje real llega antes por el
 * aviso en vivo que por la respuesta del envío, la provisoria se va y no se
 * ve dos veces. Los envíos de un chat salen de a uno y en orden.
 */

export const TEMP_PREFIX = 'tmp-';

/**
 * Dónde quedan los textos de Lines e Inbox que no salieron o esperan la red (localStorage), y los borradores de Lines
 * (sessionStorage). Todo se borra al cerrar sesión (clearOfflineData).
 */
export const UNSENT_LINES_KEY = 'zs:lines-unsent';
export const UNSENT_INBOX_KEY = 'zs:inbox-unsent';
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

/**
 * Estado de lo que no está guardado:
 * - `pending`: saliendo ahora (reloj).
 * - `queued`: escrito sin red; espera la conexión y sale solo, en orden (reloj; se puede borrar).
 * - `failed`: no salió (el servidor lo rechazó, o no respondió): reintentar o quitar.
 */
export type UnsentStatus = 'pending' | 'queued' | 'failed';

/** Un mensaje que se mandó y todavía no está guardado en el servidor: saliendo, en cola sin red, o no salió. */
export interface Unsent {
  clientId: string;
  /** Quién lo escribió: otra persona que entre en la misma pestaña no lo ve ni lo puede mandar. */
  owner: string;
  chatId: string;
  body: string;
  replyToId: string | null;
  /** Grupos de WhatsApp: teléfonos mencionados con "@<teléfono>" en el texto. */
  mentions?: string[];
  status: UnsentStatus;
  error: string;
  createdAt: string;
  /** La persona sacó la vista previa del link antes de mandar: sale sin ella (también al reintentar). */
  noPreview?: boolean;
  /** Un archivo (con `body` como su pie). */
  media?: UnsentMedia;
}

export type UnsentEvent<S> =
  | { chatId: string; entry: Unsent; type: 'added' | 'pending' | 'queued' | 'failed' | 'removed' }
  | { chatId: string; entry: Unsent; type: 'saved'; saved: S }
  /** Otra pestaña cambió lo de este chat (mandó, borró o encoló algo): volver a leer la lista. */
  | { chatId: string; entry: null; type: 'synced' };

/** ¿El navegador dice que no hay red? (sin navegador, como en los tests de servidor: hay red). */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export interface UnsentStoreOptions {
  /**
   * Dónde se guarda. `session` (por defecto): solo esta pestaña. `local`: todo el navegador, como los cambios sin
   * conexión de Docs y Board (lib/board-sync.ts): lo escrito sin red sobrevive a recargar y a cerrar la pestaña, y
   * las pestañas abiertas se enteran de lo que hace la otra (evento `storage`). Se borra al cerrar sesión
   * (clearOfflineData).
   */
  persist?: 'session' | 'local';
}

/**
 * Lo que no salió, guardado fuera del componente del chat: si el envío falla cuando la persona ya abrió otro chat
 * (o recargó la página), el texto no se pierde: al volver al chat está ahí, como no enviado, con reintentar. Al
 * recargar, lo que estaba "saliendo" queda como no enviado (no se sabe si salió): si el servidor ya lo tiene, el chat
 * lo reconoce por su clientId y lo saca. Lo que estaba en cola sin red sigue en cola.
 */
export function unsentStore<S>(storageKey: string, opts: UnsentStoreOptions = {}) {
  const persist = opts.persist ?? 'session';
  let items: Unsent[] | null = null;
  /** La persona de la sesión. Lo de otra persona no se muestra y se descarta. '' = todavía no se sabe: no se muestra nada. */
  let owner = '';
  const listeners = new Set<(e: UnsentEvent<S>) => void>();
  /** Los que tienen un pedido en curso en esta pestaña (no se mandan otra vez hasta que termine). */
  const inFlightIds = new Set<string>();
  const storage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => {
    try {
      if (persist === 'local') return typeof localStorage !== 'undefined' ? localStorage : null;
      return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
      return null;
    }
  };
  /** Lo guardado, validado. `fresh`: lo dejó otra pestaña que sigue abierta (lo "saliendo" de allá sigue saliendo). */
  const parse = (raw: string | null, fresh: boolean): Unsent[] => {
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(parsed)) return [];
      return (
        parsed
          .filter(
            (x): x is Unsent =>
              !!x && typeof x === 'object' && !!cleanClientId((x as Unsent).clientId) && typeof (x as Unsent).owner === 'string' && typeof (x as Unsent).chatId === 'string' && typeof (x as Unsent).body === 'string',
          )
          .slice(-200)
          // Un archivo que no terminó de subirse vivía solo en la pestaña: después de recargar no hay nada que mandar.
          .filter((x) => !x.media || !!x.media.url || (fresh && x.status === 'pending') || inFlightIds.has(x.clientId))
          .map((x): Unsent => {
            const base = { ...x, replyToId: x.replyToId ?? null, createdAt: x.createdAt || new Date().toISOString() };
            // Lo que esta pestaña está mandando sigue "saliendo", diga lo que diga lo guardado.
            if (inFlightIds.has(x.clientId)) return { ...base, status: 'pending', error: '' };
            if (x.status === 'failed') return { ...base, status: 'failed', error: x.error || 'send_failed' };
            if (x.status === 'queued') return { ...base, status: 'queued', error: '' };
            // Lo que estaba saliendo cuando se recargó la página: ya nadie lo está mandando.
            return fresh ? { ...base, status: 'pending', error: '' } : { ...base, status: 'failed', error: 'interrupted' };
          })
      );
    } catch {
      return [];
    }
  };
  const load = (): Unsent[] => {
    if (items) return items;
    items = parse(storage()?.getItem(storageKey) ?? null, false);
    return items;
  };
  const save = () => {
    try {
      const s = storage();
      if (!s) return;
      if (items?.length) s.setItem(storageKey, JSON.stringify(items));
      else s.removeItem(storageKey);
    } catch {
      /* cuota o modo privado: queda en memoria */
    }
  };
  const emit = (e: UnsentEvent<S>) => {
    for (const fn of [...listeners]) fn(e);
  };
  /**
   * Antes de cambiar algo, lo que dejaron las otras pestañas (`local`): así una no pisa lo que encoló o mandó la
   * otra. Sin almacenamiento, lo que hay en memoria.
   */
  const reread = (): Unsent[] => {
    if (persist !== 'local' || !items) return load();
    const s = storage();
    if (!s) return items;
    try {
      const raw = s.getItem(storageKey);
      // Lo que esta pestaña no pudo guardar (cuota) no se pierde por releer.
      if (raw === null && items.length) return items;
      items = parse(raw, true);
    } catch {
      /* sin almacenamiento: lo de memoria */
    }
    return items;
  };
  const mine = (x: Unsent) => !!owner && x.owner === owner;
  const find = (clientId: string) => load().find((x) => x.clientId === clientId && mine(x));
  const findFresh = (clientId: string) => reread().find((x) => x.clientId === clientId && mine(x));
  const drop = (clientId: string) => {
    items = reread().filter((x) => x.clientId !== clientId);
    save();
  };
  // Otra pestaña cambió la lista: se relee y cada chat que cambió se vuelve a pintar.
  if (persist === 'local' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== storageKey && e.key !== null) return;
      const before = items ?? [];
      items = parse(e.key === null ? null : e.newValue, true);
      const sig = (x: Unsent) => `${x.status}|${x.error}`;
      const prev = new Map(before.map((x) => [x.clientId, x]));
      const chats = new Set<string>();
      for (const x of items) {
        const old = prev.get(x.clientId);
        if (!old || sig(old) !== sig(x)) chats.add(x.chatId);
      }
      const now = new Set(items.map((x) => x.clientId));
      for (const x of before) if (!now.has(x.clientId)) chats.add(x.chatId);
      for (const chatId of chats) emit({ chatId, entry: null, type: 'synced' });
    });
  }
  return {
    /**
     * Quién usa la pestaña ahora (la persona de la sesión). Lo que quedó de otra persona se descarta: nunca se
     * muestra ni se manda a nombre de otro.
     */
    setOwner(id: string): void {
      owner = id;
      const all = reread();
      items = all.filter((x) => x.owner === id);
      if (items.length !== all.length) save();
    },
    list: (chatId: string): Unsent[] => (owner ? load().filter((x) => x.chatId === chatId && x.owner === owner) : []),
    /** Todo lo de esta persona, de todos los chats. */
    entries: (): Unsent[] => load().filter(mine),
    get: find,
    /** Lo que espera la red (de esta persona), en el orden en que se escribió, releído de lo guardado. */
    queued(chatId?: string): Unsent[] {
      return reread()
        .filter((x) => mine(x) && x.status === 'queued' && (chatId === undefined || x.chatId === chatId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    /** `clientId`: el de un envío que ya empezó (se cortó la red a mitad): el reintento lleva el mismo. */
    add(input: { chatId: string; body: string; replyToId: string | null; noPreview?: boolean; mentions?: string[]; media?: UnsentMedia; clientId?: string }, status: 'pending' | 'queued' = 'pending'): Unsent {
      const { media, clientId: given, ...rest } = input;
      const clientId = cleanClientId(given) ?? newClientId();
      const list = reread().filter((x) => x.clientId !== clientId);
      const entry: Unsent = { ...rest, ...(media ? { media } : {}), owner, clientId, status, error: '', createdAt: new Date().toISOString() };
      list.push(entry);
      items = list;
      save();
      emit({ chatId: entry.chatId, entry, type: 'added' });
      return entry;
    },
    /**
     * Vuelve a salir (reintento, o la cola al volver la red): la misma burbuja, otra vez "enviando". undefined si ya
     * está saliendo (dos clics en reintentar no mandan dos pedidos), otra pestaña ya lo mandó, o no es de esta persona.
     */
    pending(clientId: string): Unsent | undefined {
      if (inFlightIds.has(clientId)) return undefined;
      const entry = findFresh(clientId);
      if (!entry) return undefined;
      inFlightIds.add(clientId);
      entry.status = 'pending';
      entry.error = '';
      save();
      emit({ chatId: entry.chatId, entry, type: 'pending' });
      return entry;
    },
    /** Sin red: queda en cola (reloj) y sale solo cuando vuelva la conexión. */
    queue(clientId: string): void {
      inFlightIds.delete(clientId);
      const entry = findFresh(clientId);
      if (!entry) return;
      entry.status = 'queued';
      entry.error = '';
      save();
      emit({ chatId: entry.chatId, entry, type: 'queued' });
    },
    fail(clientId: string, error: string): void {
      inFlightIds.delete(clientId);
      const entry = findFresh(clientId);
      if (!entry) return;
      entry.status = 'failed';
      entry.error = error || 'send_failed';
      save();
      emit({ chatId: entry.chatId, entry, type: 'failed' });
    },
    /** El servidor lo guardó: sale de acá y quien mira recibe el mensaje guardado. */
    saved(clientId: string, saved: S): void {
      inFlightIds.delete(clientId);
      const entry = find(clientId) ?? findFresh(clientId);
      if (!entry) return;
      drop(clientId);
      emit({ chatId: entry.chatId, entry, type: 'saved', saved });
    },
    /** El archivo de un envío terminó de subirse (o se supo su tamaño): queda guardado para un reintento. */
    setMedia(clientId: string, patch: Partial<UnsentMedia>): void {
      const entry = findFresh(clientId);
      if (!entry?.media) return;
      entry.media = { ...entry.media, ...patch };
      save();
    },
    /** Se quita (la persona lo descartó, o el chat ya trae su mensaje guardado). */
    remove(clientId: string): void {
      inFlightIds.delete(clientId);
      const entry = findFresh(clientId) ?? find(clientId);
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

export type UnsentStore<S> = ReturnType<typeof unsentStore<S>>;

/**
 * La cola sin conexión de un store (Lines e Inbox): lo que quedó `queued` sale solo, de a uno y en el orden en que
 * se escribió, cuando vuelve la red (evento `online`), al abrir la app con red, o cuando se pide (`flush`). `send`
 * manda uno y termina cuando se sabe cómo le fue; si mientras tanto se cortó la red, la vuelta se detiene y lo que
 * falta espera la próxima.
 *
 * Una sola pestaña a la vez manda la cola (Web Locks, `lockName`): la otra espera su turno y, como antes de mandar
 * cada uno se relee lo guardado, no vuelve a mandar lo que la primera ya mandó. Si igual llegaran dos pedidos con el
 * mismo clientId (sin Web Locks, o en dos instancias del servidor), el servidor manda uno solo (lib/send-once.ts).
 */
export function offlineOutbox<S>(store: UnsentStore<S>, lockName: string, send: (clientId: string) => Promise<unknown>) {
  let running: Promise<void> | null = null;
  let again = false;
  const once = async () => {
    const tried = new Set<string>();
    for (;;) {
      if (isOffline()) return;
      const next = store.queued().find((x) => !tried.has(x.clientId));
      if (!next) return;
      tried.add(next.clientId);
      await send(next.clientId);
      // Sigue en cola: se cortó la red. Lo que falta espera a que vuelva.
      if (store.queued().some((x) => x.clientId === next.clientId)) return;
    }
  };
  const locked = (): Promise<void> => {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    return locks?.request ? locks.request(lockName, once).then(() => undefined) : once();
  };
  function flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = locked()
      .catch(() => undefined)
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void flush();
        }
      });
    return running;
  }
  let listening = false;
  return {
    flush,
    /** Escucha la vuelta de la red (una vez por pestaña) y, si ya hay red, manda lo que esperaba. */
    start(): void {
      if (!listening && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        listening = true;
        window.addEventListener('online', () => void flush());
        // Otra pestaña encoló algo con red (o la red volvió allá primero): que salga.
        store.subscribe((e) => {
          if (e.type === 'synced' && !isOffline() && store.queued(e.chatId).length) void flush();
        });
      }
      if (!isOffline() && store.queued().length) void flush();
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
