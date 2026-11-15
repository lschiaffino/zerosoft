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

/** Guarda una foto y devuelve la URL nuestra ('' si no se pudo). */
export type StorePicture = (url: string) => Promise<string>;

/** Una data URL chica (solo el proveedor falso) queda tal cual; una URL de WhatsApp se baja a nuestro storage. */
export async function defaultStorePicture(url: string): Promise<string> {
  if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url.length <= 64_000 ? url : '';
  if (!/^https:\/\//.test(url)) return '';
  const { storePicture } = await import('./groups-import');
  return storePicture(url);
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
  if (!list.length) return 0;
  const db = getDb();
  let rows = await lookupContacts(scope, list);
  const missing = list.filter((p) => !rows.has(p));
  if (missing.length) {
    await rememberContacts(scope, missing.slice(0, 500).map((phone) => ({ phone })), now).catch(() => []);
    rows = await lookupContacts(scope, list);
  }
  const seen = new Set<string>();
  const due: PictureRow[] = [];
  for (const p of list) {
    const r = rows.get(p) as PictureRow | undefined;
    // Solo teléfonos: unos dígitos que la libreta conoce como lid no son un número al que pedirle la foto.
    if (!r || seen.has(r.id) || r.phone !== p) continue;
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
      if (asked++ > 0 && gap > 0) await sleep(gap);
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
    await applyPicture(r, url, store);
    checked++;
  }
  return checked;
}

/** Guarda lo que dijo WhatsApp de la foto de una persona: nueva, la misma o ninguna. */
export async function applyPicture(r: Pick<PictureRow, 'id' | 'picture' | 'picture_src'>, url: string, store: StorePicture = defaultStorePicture): Promise<void> {
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
    return;
  }
  const src = pictureSource(url);
  if (src && src === r.picture_src && r.picture) return;
  const stored = await store(url).catch(() => '');
  if (!stored) return;
  await db.prepare('UPDATE wa_contacts SET picture = ?, picture_src = ? WHERE id = ?').run(stored.slice(0, 64_000), src, r.id);
  if (ours(r.picture) && r.picture !== stored) {
    const { deleteUploads } = await import('./uploads');
    await deleteUploads([r.picture]).catch(() => null);
  }
}

/**
 * Pide las fotos después de responder (al abrir un grupo), sin frenar la
 * respuesta. Una tanda por cuenta a la vez.
 */
export async function refreshPicturesSoon(scope: ContactScope, provider: () => Pick<GroupsProvider, 'profilePicture'> | null, phones: string[], opts: PictureRefreshOptions = {}): Promise<void> {
  const key = `${scope.app}:${scope.accountId}`;
  if (!phones.length || running.has(key) || (paused.get(key) ?? 0) > Date.now()) return;
  const job = async () => {
    if (running.has(key)) return;
    running.add(key);
    try {
      const p = provider();
      if (p) await refreshContactPictures(scope, p, phones, opts);
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
