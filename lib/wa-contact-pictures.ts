/**
 * Fotos de perfil de las personas de la libreta de WhatsApp (lib/wa-contacts.ts),
 * para Inbox y Lines: los remitentes y participantes de un grupo, las
 * menciones y la ficha del contacto. Antes solo tenían foto los chats (la del
 * chat 1:1 o la del grupo); quien escribía en un grupo sin tener un chat 1:1
 * con la cuenta quedaba con sus iniciales aunque tuviera foto en WhatsApp.
 *
 * Cómo se piden (WhatsApp corta con 429 si se le pide mucho):
 * - de a una persona, con una pausa entre pedidos y un tope por tanda;
 * - cada fila se reclama con compare-and-set sobre picture_at (dos corridas
 *   nunca piden la misma), y se vuelve a pedir pasada una semana;
 * - un 429 frena la tanda, devuelve el reclamo y pausa la cuenta un rato;
 * - una foto que no cambió (misma URL sin la firma) no se vuelve a bajar.
 *
 * Chats 1:1: al abrirlos y en el repaso diario se pide la foto de la persona
 * del chat (refreshDmPicture), y la pantalla la muestra antes que la del chat
 * (dmAvatar). La URL que vino con el chat se aprovecha sin pedir otra.
 *
 * Dónde se guardan: la URL de WhatsApp vence a las semanas, así que la foto se
 * baja una vez a nuestro storage (como la de los chats de Lines,
 * lib/groups-import.ts storePicture) y la pantalla usa esa copia.
 * Server-only.
 */
import { getDb } from './db';
import { ProviderError, type GroupsProvider } from './groups-provider';
import { lookupContacts, rememberContacts, type ContactRow, type ContactScope } from './wa-contacts';

/** Cada cuánto se vuelve a pedir la foto de una persona. */
export const PICTURE_TTL_MS = 7 * 86_400_000;
/** Pausa entre pedidos al servidor de WhatsApp. */
export const PICTURE_GAP_MS = 400;
/** Cuánto se espera después de un 429 antes de volver a pedir fotos de esa cuenta. */
export const PICTURE_PAUSE_MS = 10 * 60_000;
/** Personas por tanda (al abrir un grupo). */
export const PICTURE_BATCH = 12;

export interface PictureRow extends ContactRow {
  picture: string;
  picture_src: string;
  picture_at: string | null;
}

/** Cuentas pausadas por un 429 ("app:cuenta" → hasta cuándo, ms). */
const paused = new Map<string, number>();
/** Tandas en curso por cuenta (al abrir el mismo grupo dos veces no se piden dos veces). */
const running = new Set<string>();

export function resetPicturePauses(): void {
  paused.clear();
  running.clear();
}

/** ¿Toca pedir la foto? Nunca se pidió o se pidió hace más de una semana. */
export function pictureDue(r: Pick<PictureRow, 'picture_at'>, now: Date): boolean {
  if (!r.picture_at) return true;
  const at = Date.parse(r.picture_at);
  return !Number.isFinite(at) || at < now.getTime() - PICTURE_TTL_MS;
}

/** Lo que identifica la foto en WhatsApp: la URL sin la firma que vence (o la data URL del proveedor falso). */
export function pictureSource(url: string): string {
  if (url.startsWith('data:')) {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
    return `data:${url.length}:${h >>> 0}`;
  }
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 500);
  } catch {
    return '';
  }
}

/** Fotos guardadas por dígitos (teléfono o lid). Solo las que hay. */
export async function contactPictures(scope: Pick<ContactScope, 'app' | 'accountId'>, digits: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!digits.length) return out;
  const rows = await lookupContacts(scope, digits);
  for (const d of digits) {
    const pic = (rows.get(d) as PictureRow | undefined)?.picture;
    if (pic) out.set(d, pic);
  }
  return out;
}

/** Guarda una foto y devuelve la URL nuestra ('' si no se pudo). `scope`: de qué cuenta es (el dueño del archivo). */
export type StorePicture = (url: string, scope?: ContactScope) => Promise<string>;

/**
 * Una data URL chica (solo el proveedor falso) queda tal cual; una URL de
 * WhatsApp se baja a nuestro storage privado: en Lines la ve quien ve esa
 * línea; en Inbox (personal), solo la persona dueña de la cuenta.
 */
export async function defaultStorePicture(url: string, scope?: ContactScope): Promise<string> {
  if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url.length <= 64_000 ? url : '';
  if (!/^https:\/\//.test(url) || !scope?.userId) return '';
  const { downloadPicture } = await import('./groups-import');
  const pic = await downloadPicture(url);
  if (!pic) return '';
  const { saveUpload } = await import('./uploads');
  return saveUpload('chat', pic.name, pic.type, pic.data, scope.app === 'lines'
    ? { workspaceId: scope.userId, userId: null, app: 'groups', access: 'workspace', scope: `groups-number:${scope.accountId}` }
    : { workspaceId: scope.userId, userId: scope.userId, app: 'inbox', access: 'user' });
}

const ours = (url: string) => !!url && !url.startsWith('data:');

export interface PictureRefreshOptions {
  now?: Date;
  /** Hasta cuándo (ms): la tanda corta antes. */
  deadline?: number;
  /** Personas por tanda. */
  limit?: number;
  gapMs?: number;
  store?: StorePicture;
  /**
   * Personas que solo se conocen por lid (un chat 1:1 "@lid"): se piden si la libreta las tiene con
   * ese lid. A diferencia de `phones`, unos dígitos que la libreta no conoce no entran como teléfono.
   */
  lids?: string[];
  /** Pausa también antes del primer pedido (el repaso diario acaba de pedirle otra cosa al servidor). */
  gapFirst?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pide las fotos de esas personas (teléfonos, en orden de prioridad: primero
 * las que se ven) que nunca se pidieron o vencieron. Devuelve cuántas se
 * revisaron. Una persona que no estaba en la libreta entra (sin nombre).
 */
export async function refreshContactPictures(
  scope: ContactScope,
  provider: Pick<GroupsProvider, 'profilePicture'>,
  phones: string[],
  opts: PictureRefreshOptions = {},
): Promise<number> {
  if (!provider.profilePicture) return 0;
  const key = `${scope.app}:${scope.accountId}`;
  if ((paused.get(key) ?? 0) > Date.now()) return 0;
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? Date.now() + 8_000;
  const limit = Math.max(1, Math.min(opts.limit ?? PICTURE_BATCH, 200));
  const gap = opts.gapMs ?? PICTURE_GAP_MS;
  const store = opts.store ?? defaultStorePicture;
  const list = [...new Set(phones.filter((p) => /^\d{8,15}$/.test(p)))].slice(0, 2000);
  const lids = [...new Set((opts.lids ?? []).filter((d) => /^\d{5,20}$/.test(d)))].slice(0, 200);
  if (!list.length && !lids.length) return 0;
  const db = getDb();
  let rows = await lookupContacts(scope, [...list, ...lids]);
  const missing = list.filter((p) => !rows.has(p));
  if (missing.length) {
    await rememberContacts(scope, missing.slice(0, 500).map((phone) => ({ phone })), now).catch(() => []);
    rows = await lookupContacts(scope, [...list, ...lids]);
  }
  const seen = new Set<string>();
  const due: PictureRow[] = [];
  const wanted: Array<[string, 'phone' | 'lid']> = [...list.map((p): [string, 'phone'] => [p, 'phone']), ...lids.map((d): [string, 'lid'] => [d, 'lid'])];
  for (const [p, as] of wanted) {
    const r = rows.get(p) as PictureRow | undefined;
    // Un teléfono tiene que ser el de la fila: unos dígitos que la libreta conoce como lid no son un número al
    // que pedirle la foto. Un lid, el lid de la fila (se pide por teléfono si la libreta lo sabe).
    if (!r || seen.has(r.id) || (as === 'phone' ? r.phone !== p : r.lid !== p)) continue;
    seen.add(r.id);
    if (pictureDue(r, now)) due.push(r);
    if (due.length >= limit) break;
  }
  if (!due.length) return 0;
  const at = now.toISOString();
  let checked = 0;
  let asked = 0;
  for (const r of due) {
    if (Date.now() + 500 > deadline) break;
    const claim = await db.prepare('UPDATE wa_contacts SET picture_at = ? WHERE id = ? AND picture_at IS ?').run(at, r.id, r.picture_at ?? null);
    if (!claim.changes) continue;
    let url: string;
    try {
      if ((asked++ > 0 || opts.gapFirst) && gap > 0) await sleep(gap);
      url = await provider.profilePicture(r.phone ? `${r.phone}@s.whatsapp.net` : `${r.lid}@lid`);
    } catch (err) {
      // No se supo: se devuelve el reclamo (se vuelve a pedir en la próxima). Un 429 frena la cuenta un rato.
      await db.prepare('UPDATE wa_contacts SET picture_at = ? WHERE id = ? AND picture_at = ?').run(r.picture_at ?? null, r.id, at);
      if (err instanceof ProviderError && err.code === 'rate_limited') {
        paused.set(key, Date.now() + PICTURE_PAUSE_MS);
        break;
      }
      if (err instanceof ProviderError && (err.code === 'unreachable' || err.code === 'not_connected' || err.code === 'auth_failed')) break;
      continue;
    }
    await applyPicture(r, url, store, scope);
    checked++;
  }
  return checked;
}

/** Qué pasó con la foto: se guardó una nueva, era la misma, no tiene, o no se pudo bajar. */
export type PictureOutcome = 'stored' | 'same' | 'none' | 'failed';

/** Guarda lo que dijo WhatsApp de la foto de una persona: nueva, la misma o ninguna. */
export async function applyPicture(
  r: Pick<PictureRow, 'id' | 'picture' | 'picture_src'>,
  url: string,
  store: StorePicture = defaultStorePicture,
  /** De qué cuenta es la foto (el dueño del archivo guardado). */
  scope?: ContactScope,
): Promise<PictureOutcome> {
  const db = getDb();
  if (!url) {
    // Sin foto (la sacó, o su privacidad no deja verla): como en WhatsApp, iniciales.
    if (r.picture || r.picture_src) {
      await db.prepare("UPDATE wa_contacts SET picture = '', picture_src = '' WHERE id = ?").run(r.id);
      if (ours(r.picture)) {
        const { deleteUploads } = await import('./uploads');
        await deleteUploads([r.picture]).catch(() => null);
      }
    }
    return 'none';
  }
  const src = pictureSource(url);
  if (src && src === r.picture_src && r.picture) return 'same';
  const stored = await store(url, scope).catch(() => '');
  if (!stored) return 'failed';
  await db.prepare('UPDATE wa_contacts SET picture = ?, picture_src = ? WHERE id = ?').run(stored.slice(0, 64_000), src, r.id);
  if (ours(r.picture) && r.picture !== stored) {
    const { deleteUploads } = await import('./uploads');
    await deleteUploads([r.picture]).catch(() => null);
  }
  return 'stored';
}

// ---------------------------------------------------------------------------
// Chats 1:1
// ---------------------------------------------------------------------------

/** La persona de un chat 1:1: por teléfono, o por lid si el chat es "@lid". Vacío si no se sabe. */
export interface DmPerson {
  phone?: string;
  lid?: string;
}

export function dmPerson(handle: string, chatId: string): DmPerson {
  if (chatId.endsWith('@g.us')) return {};
  const d = (handle || chatId.replace(/@.*/, '')).replace(/\D/g, '');
  if (chatId.endsWith('@lid')) return /^\d{5,20}$/.test(d) ? { lid: d } : {};
  return /^\d{8,15}$/.test(d) ? { phone: d } : {};
}

/** La foto que muestra un chat 1:1: la guardada de la persona (copia nuestra, al día) y, si no hay, la del chat. */
export function dmAvatar(stored: string | undefined | null, chatPicture: string): string {
  return stored || chatPicture;
}

/** ¿Una URL de foto que se puede bajar? (https, o la data URL del proveedor falso) */
const pictureUrlOk = (url: string) => url.startsWith('https://') || url.startsWith('data:image/');

/**
 * Una URL de foto que vino con el chat 1:1 (chatInfo o el historial) pasa a la libreta: se baja una
 * copia a nuestro storage sin pedirle nada más a WhatsApp. `fresh`: la URL se acaba de pedir (el
 * repaso diario), así que una foto distinta de la guardada la reemplaza; si no (la que quedó en el
 * chat), solo sirve cuando la persona todavía no tiene foto guardada (puede ser más vieja).
 * Devuelve true si la persona quedó con su foto al día (no hace falta pedirla a WhatsApp).
 */
export async function adoptChatPicture(scope: ContactScope, who: DmPerson, url: string, opts: { now?: Date; fresh?: boolean; store?: StorePicture } = {}): Promise<boolean> {
  const digits = who.phone || who.lid;
  if (!digits || !url || !pictureUrlOk(url)) return false;
  const now = opts.now ?? new Date();
  let r = (await lookupContacts(scope, [digits])).get(digits) as PictureRow | undefined;
  if (!r && who.phone) {
    await rememberContacts(scope, [{ phone: who.phone }], now).catch(() => []);
    r = (await lookupContacts(scope, [digits])).get(digits) as PictureRow | undefined;
  }
  if (!r || (who.phone ? r.phone !== who.phone : r.lid !== who.lid)) return false;
  const src = pictureSource(url);
  const changed = !!src && src !== r.picture_src;
  const due = pictureDue(r, now);
  if (!opts.fresh) {
    // La del chat solo sirve si la persona no tiene foto guardada y no se le pidió hace poco (si se le pidió y
    // no tenía, eso manda). Con foto vencida se pide a WhatsApp.
    if (!due) return !!r.picture;
    if (r.picture) return false;
  } else if (r.picture && !due && !changed) return true;
  const db = getDb();
  const at = now.toISOString();
  const claim = await db.prepare('UPDATE wa_contacts SET picture_at = ? WHERE id = ? AND picture_at IS ?').run(at, r.id, r.picture_at ?? null);
  if (!claim.changes) return true;
  if ((await applyPicture(r, url, opts.store ?? defaultStorePicture, scope)) === 'failed') {
    // Venció o no se pudo bajar: se devuelve el reclamo y se pide a WhatsApp.
    await db.prepare('UPDATE wa_contacts SET picture_at = ? WHERE id = ? AND picture_at = ?').run(r.picture_at ?? null, r.id, at);
    return false;
  }
  return true;
}

async function storedPicture(scope: Pick<ContactScope, 'app' | 'accountId'>, who: DmPerson): Promise<string> {
  const d = who.phone || who.lid;
  return d ? ((await contactPictures(scope, [d]).catch(() => new Map<string, string>())).get(d) ?? '') : '';
}

/**
 * La foto de la persona de un chat 1:1. Primero la URL que vino con el chat (`chatPicture`, sin otro
 * pedido); si no sirve, se pide a WhatsApp con los mismos topes de siempre (cada 7 días, pausa por un
 * 429). Devuelve true si la foto guardada cambió.
 */
export async function refreshDmPicture(
  scope: ContactScope,
  provider: Pick<GroupsProvider, 'profilePicture'> | null,
  who: DmPerson,
  opts: PictureRefreshOptions & { chatPicture?: string; fresh?: boolean } = {},
): Promise<boolean> {
  if (!who.phone && !who.lid) return false;
  const before = await storedPicture(scope, who);
  const adopted = opts.chatPicture ? await adoptChatPicture(scope, who, opts.chatPicture, { now: opts.now, fresh: opts.fresh, store: opts.store }).catch(() => false) : false;
  if (!adopted && provider) await refreshContactPictures(scope, provider, who.phone ? [who.phone] : [], { ...opts, limit: 1, lids: who.lid ? [who.lid] : [] });
  return (await storedPicture(scope, who)) !== before;
}

/**
 * Pide las fotos después de responder (al abrir un grupo), sin frenar la
 * respuesta. Una tanda por cuenta a la vez.
 */
export async function refreshPicturesSoon(scope: ContactScope, provider: () => Pick<GroupsProvider, 'profilePicture'> | null, phones: string[], opts: PictureRefreshOptions = {}): Promise<void> {
  if (!phones.length && !opts.lids?.length) return;
  await soon(scope, async () => {
    const p = provider();
    if (p) await refreshContactPictures(scope, p, phones, opts);
  });
}

/**
 * Al abrir un chat 1:1 sin foto guardada o vencida: la de la persona, después de responder. Si
 * cambió, `onChange` avisa a la pantalla (la lista y el chat la muestran sin recargar).
 */
export async function refreshDmPictureSoon(
  scope: ContactScope,
  provider: () => Pick<GroupsProvider, 'profilePicture'> | null,
  who: DmPerson,
  opts: { chatPicture?: string; onChange?: () => Promise<unknown>; alsoPhones?: string[] } = {},
): Promise<void> {
  const also = opts.alsoPhones ?? [];
  if (!who.phone && !who.lid && !also.length) return;
  await soon(scope, async () => {
    const p = provider();
    if ((who.phone || who.lid) && (await refreshDmPicture(scope, p, who, { chatPicture: opts.chatPicture }))) await opts.onChange?.();
    // De paso, las personas de las tarjetas de contacto del chat (en la misma tanda, con los mismos topes).
    if (also.length && p && (await refreshContactPictures(scope, p, also, { gapFirst: true })) > 0) await opts.onChange?.();
  });
}

// ---------------------------------------------------------------------------
// Tarjetas de contacto (vCard)
// ---------------------------------------------------------------------------

/** Una tarjeta de contacto de un mensaje: el primer teléfono es el de WhatsApp (waid) si la vCard lo trae. */
export interface CardLike {
  phones?: string[];
  picture?: string;
}

/** Los teléfonos de las tarjetas de contacto de unos mensajes (para pedir sus fotos). */
export function cardPhones(cards: Array<CardLike[] | undefined | null>, limit = 40): string[] {
  const out = new Set<string>();
  for (const list of cards) for (const c of list ?? []) {
    const d = (c.phones?.[0] ?? '').replace(/\D/g, '');
    if (/^\d{8,15}$/.test(d)) out.add(d);
    if (out.size >= limit) return [...out];
  }
  return [...out];
}

/** Cada tarjeta de contacto lleva la foto guardada de esa persona, si hay (la pantalla muestra el ícono si no). */
export async function withCardPictures(scope: Pick<ContactScope, 'app' | 'accountId'>, cards: Array<CardLike[] | undefined | null>): Promise<void> {
  const phones = cardPhones(cards, 500);
  if (!phones.length) return;
  const pics = await contactPictures(scope, phones);
  for (const list of cards)
    for (const c of list ?? []) {
      const pic = pics.get((c.phones?.[0] ?? '').replace(/\D/g, ''));
      if (pic) c.picture = pic;
    }
}

/** Una tanda por cuenta a la vez, después de responder (fuera de un pedido, enseguida). */
async function soon(scope: Pick<ContactScope, 'app' | 'accountId'>, work: () => Promise<void>): Promise<void> {
  const key = `${scope.app}:${scope.accountId}`;
  if (running.has(key) || (paused.get(key) ?? 0) > Date.now()) return;
  const job = async () => {
    if (running.has(key)) return;
    running.add(key);
    try {
      await work();
    } catch {
      // Una foto que no llegó no rompe nada: queda para la próxima.
    } finally {
      running.delete(key);
    }
  };
  try {
    const { after } = await import('next/server');
    after(job);
  } catch {
    void job();
  }
}
