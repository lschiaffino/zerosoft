/**
 * WhatsApp: la privacidad de "Confirmaciones de lectura" de cada línea de
 * Lines (groups_numbers.read_receipts) y de cada cuenta de Inbox
 * (inbox_accounts.read_receipts): 'all', 'none' o '' (no se sabe), con la hora
 * en que se leyó del servidor (privacy_at).
 *
 * Se lee al conectar, en el repaso diario (lib/wa-contacts-refresh.ts) y, si
 * pasó más de un día, al abrir un chat (después de responder).
 *
 * Para qué sirve: con las confirmaciones apagadas, el WhatsApp del teléfono
 * muestra los 1:1 salientes siempre con tildes grises (WhatsApp esconde si el
 * otro leyó cuando uno no lo deja ver). El dispositivo vinculado igual recibe
 * el aviso de leído, y zerosoft muestra todo lo que sabe: tildes azules (y el
 * micrófono azul de un audio escuchado). El dato solo cambia la explicación de
 * las tildes ("Leído. Tu WhatsApp no te lo muestra…"). El estado guardado de
 * cada mensaje no se toca, y las métricas y filtros que usan "leído" siguen
 * usando el valor real. Los grupos no cambian: WhatsApp sigue mostrando ahí
 * quién leyó. Server-only.
 */
import { after } from 'next/server';
import { getDb } from './db';
import type { GroupsProvider, ReadReceiptsSetting } from './groups-provider';

export type WaPrivacyApp = 'lines' | 'inbox';

/** Cada cuánto se vuelve a leer del servidor. */
export const PRIVACY_TTL_MS = 24 * 3600_000;

const TABLE: Record<WaPrivacyApp, string> = { lines: 'groups_numbers', inbox: 'inbox_accounts' };

/** '' cuando no se sabe. */
export function readReceiptsOf(raw: unknown): ReadReceiptsSetting | '' {
  return raw === 'all' || raw === 'none' ? raw : '';
}

/**
 * ¿El WhatsApp de la persona esconde si el otro leyó este chat? Solo en 1:1 y
 * con las confirmaciones de lectura apagadas.
 */
export function readHiddenInWhatsapp(readReceipts: unknown, isGroup: boolean): boolean {
  return !isGroup && readReceiptsOf(readReceipts) === 'none';
}

export function privacyStale(privacyAt: string | null | undefined, now = new Date()): boolean {
  if (!privacyAt) return true;
  const t = Date.parse(privacyAt);
  return !Number.isFinite(t) || now.getTime() - t >= PRIVACY_TTL_MS;
}

/**
 * Pide la privacidad al servidor y la guarda. Si el servidor no la dice (o el
 * proveedor no la sabe, como WAHA) queda lo que había y la hora (no se insiste
 * hasta el día siguiente). Si falla (caído, desconectado) no guarda nada.
 * Devuelve lo que quedó guardado, o null si no se pudo preguntar.
 */
export async function refreshPrivacy(app: WaPrivacyApp, id: string, provider: GroupsProvider, now = new Date()): Promise<ReadReceiptsSetting | '' | null> {
  let setting: ReadReceiptsSetting | '' = '';
  if (provider.privacySettings) {
    try {
      setting = readReceiptsOf((await provider.privacySettings())?.readReceipts);
    } catch {
      return null;
    }
  }
  const db = getDb();
  await db
    .prepare(`UPDATE ${TABLE[app]} SET read_receipts = CASE WHEN ? != '' THEN ? ELSE read_receipts END, privacy_at = ? WHERE id = ?`)
    .run(setting, setting, now.toISOString(), id);
  const row = (await db.prepare(`SELECT read_receipts FROM ${TABLE[app]} WHERE id = ?`).get(id)) as { read_receipts?: string } | undefined;
  return readReceiptsOf(row?.read_receipts);
}

/** Si el dato tiene más de un día, lo vuelve a leer después de responder (fuera de un request, en el acto). */
export async function refreshPrivacyIfStale(
  app: WaPrivacyApp,
  row: { id: string; privacy_at?: string | null },
  provider: () => GroupsProvider,
  now = new Date(),
): Promise<void> {
  if (!privacyStale(row.privacy_at, now)) return;
  const job = async () => {
    let p: GroupsProvider;
    try {
      p = provider();
    } catch {
      return;
    }
    await refreshPrivacy(app, row.id, p, now).catch(() => null);
  };
  try {
    after(job);
  } catch {
    await job();
  }
}

/** Ids (de la lista) de las líneas o cuentas con las confirmaciones de lectura apagadas. */
export async function receiptsOffIds(app: WaPrivacyApp, ids: string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Set();
  const rows = (await getDb()
    .prepare(`SELECT id FROM ${TABLE[app]} WHERE id IN (${uniq.map(() => '?').join(',')}) AND read_receipts = 'none'`)
    .all(...uniq)) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}
