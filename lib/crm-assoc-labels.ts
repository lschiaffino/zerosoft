/**
 * CRM — labels de asociación propios del workspace (como los de HubSpot:
 * "Contacto de facturación", "Decisor"). Server-only salvo lo puro de arriba.
 *
 * - Pares con label: contacto ↔ empresa y deal ↔ contacto.
 * - contacto ↔ empresa trae labels de fábrica (CONTACT_COMPANY_LABELS); el
 *   workspace suma los suyos. deal ↔ contacto solo usa los del workspace.
 * - En las asociaciones el label se guarda como la clave de fábrica o como
 *   `custom:<id>`. Al borrar un label, las asociaciones que lo usaban quedan
 *   sin label.
 * - Leer los labels: cualquiera del workspace (los necesita la ficha).
 *   Crearlos, renombrarlos y borrarlos: owner y admins (la ruta lo controla).
 */
import { CONTACT_COMPANY_LABELS } from './crm-constants';
import { CrmRefError } from './crm-refs';
import { getDb, type Db } from './db';

export const ASSOC_LABEL_PAIRS = ['contact_company', 'deal_contact'] as const;
export type AssocLabelPair = (typeof ASSOC_LABEL_PAIRS)[number];

export const CUSTOM_LABEL_PREFIX = 'custom:';
export const MAX_ASSOC_LABELS = 50;
export const MAX_ASSOC_LABEL_NAME = 60;

export interface CrmAssociationLabelRow {
  id: string;
  user_id: string;
  pair: AssocLabelPair;
  name: string;
  position: number;
  created_at: string;
}

export function isAssocLabelPair(v: unknown): v is AssocLabelPair {
  return typeof v === 'string' && (ASSOC_LABEL_PAIRS as readonly string[]).includes(v);
}

/** Valor guardado de un label propio. */
export function customLabelValue(id: string): string {
  return CUSTOM_LABEL_PREFIX + id;
}

/**
 * Valida un label para un par y devuelve el valor a guardar ('' = sin label).
 * Puro: recibe los ids de los labels propios del par en el workspace.
 */
export function resolveAssocLabel(
  pair: AssocLabelPair,
  raw: string | null | undefined,
  customIds: ReadonlySet<string>,
): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (v.startsWith(CUSTOM_LABEL_PREFIX)) {
    if (customIds.has(v.slice(CUSTOM_LABEL_PREFIX.length))) return v;
    throw new CrmRefError('invalid_label');
  }
  if (pair === 'contact_company' && (CONTACT_COMPANY_LABELS as readonly string[]).includes(v)) return v;
  throw new CrmRefError('invalid_label');
}

/**
 * Opciones del selector de label de un par: las de fábrica (traducidas por
 * quien llama) y después las del workspace. Pura.
 */
export function assocLabelOptions(
  pair: AssocLabelPair,
  custom: Array<Pick<CrmAssociationLabelRow, 'id' | 'name' | 'pair'>>,
  builtinLabel: (key: string) => string,
): Array<{ value: string; label: string }> {
  const builtin = pair === 'contact_company' ? CONTACT_COMPANY_LABELS.map((k) => ({ value: k, label: builtinLabel(k) })) : [];
  return [
    ...builtin,
    ...custom.filter((c) => c.pair === pair).map((c) => ({ value: customLabelValue(c.id), label: c.name })),
  ];
}

// ---------- Server ----------

function cleanName(name: string): string {
  const v = name.replace(/\s+/g, ' ').trim();
  if (!v || v.length > MAX_ASSOC_LABEL_NAME) throw new CrmRefError('invalid_label');
  return v;
}

export async function listAssociationLabels(
  workspaceId: string,
  pair?: AssocLabelPair,
  db: Db = getDb(),
): Promise<CrmAssociationLabelRow[]> {
  if (pair) {
    return (await db
      .prepare(
        'SELECT * FROM crm_association_labels WHERE user_id = ? AND pair = ? ORDER BY position ASC, created_at ASC, rowid ASC',
      )
      .all(workspaceId, pair)) as CrmAssociationLabelRow[];
  }
  return (await db
    .prepare('SELECT * FROM crm_association_labels WHERE user_id = ? ORDER BY pair ASC, position ASC, created_at ASC, rowid ASC')
    .all(workspaceId)) as CrmAssociationLabelRow[];
}

/** Ids de los labels propios del par (para validar un valor). */
export async function customLabelIds(workspaceId: string, pair: AssocLabelPair, db: Db = getDb()): Promise<Set<string>> {
  return new Set((await listAssociationLabels(workspaceId, pair, db)).map((r) => r.id));
}

/** Valida y normaliza un label contra los del workspace. Lanza CrmRefError('invalid_label'). */
export async function normalizeAssocLabel(
  workspaceId: string,
  pair: AssocLabelPair,
  raw: string | null | undefined,
  db: Db = getDb(),
): Promise<string> {
  const v = (raw ?? '').trim();
  if (!v) return '';
  return resolveAssocLabel(pair, v, v.startsWith(CUSTOM_LABEL_PREFIX) ? await customLabelIds(workspaceId, pair, db) : new Set());
}

async function assertUniqueName(db: Db, workspaceId: string, pair: AssocLabelPair, name: string, exceptId?: string): Promise<void> {
  const dup = await db
    .prepare('SELECT 1 FROM crm_association_labels WHERE user_id = ? AND pair = ? AND lower(name) = lower(?) AND id != ?')
    .get(workspaceId, pair, name, exceptId ?? '');
  if (dup) throw new CrmRefError('duplicate_label');
}

/** Dos altas a la vez con el mismo nombre: el índice único rechaza la segunda. */
async function uniqueOrDuplicate(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err))) throw new CrmRefError('duplicate_label');
    throw err;
  }
}

export async function createAssociationLabel(
  workspaceId: string,
  pair: AssocLabelPair,
  name: string,
  db: Db = getDb(),
): Promise<CrmAssociationLabelRow> {
  const clean = cleanName(name);
  const count = (await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM crm_association_labels WHERE user_id = ? AND pair = ?')
    .get(workspaceId, pair)) as { n: number; last: number };
  if (count.n >= MAX_ASSOC_LABELS) throw new CrmRefError('too_many_labels');
  await assertUniqueName(db, workspaceId, pair, clean);
  const id = crypto.randomUUID();
  await uniqueOrDuplicate(
    db
      .prepare('INSERT INTO crm_association_labels (id, user_id, pair, name, position) VALUES (?, ?, ?, ?, ?)')
      .run(id, workspaceId, pair, clean, count.last + 1),
  );
  return (await db.prepare('SELECT * FROM crm_association_labels WHERE id = ?').get(id)) as CrmAssociationLabelRow;
}

/** Renombra un label. null si no es del workspace. */
export async function renameAssociationLabel(
  workspaceId: string,
  id: string,
  name: string,
  db: Db = getDb(),
): Promise<CrmAssociationLabelRow | null> {
  const row = (await db
    .prepare('SELECT * FROM crm_association_labels WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as CrmAssociationLabelRow | undefined;
  if (!row) return null;
  const clean = cleanName(name);
  await assertUniqueName(db, workspaceId, row.pair, clean, id);
  await uniqueOrDuplicate(db.prepare('UPDATE crm_association_labels SET name = ? WHERE id = ? AND user_id = ?').run(clean, id, workspaceId));
  return { ...row, name: clean };
}

/** Borra un label y lo quita de las asociaciones que lo usaban. false si no es del workspace. */
export async function deleteAssociationLabel(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const row = (await db
    .prepare('SELECT pair FROM crm_association_labels WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as { pair: AssocLabelPair } | undefined;
  if (!row) return false;
  const value = customLabelValue(id);
  if (row.pair === 'contact_company') {
    await db.prepare("UPDATE crm_contact_companies SET label = '' WHERE user_id = ? AND label = ?").run(workspaceId, value);
  } else {
    await db
      .prepare(
        `UPDATE crm_deal_contacts SET label = '' WHERE label = ?
         AND deal_id IN (SELECT id FROM crm_deals WHERE user_id = ?)`,
      )
      .run(value, workspaceId);
  }
  await db.prepare('DELETE FROM crm_association_labels WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return true;
}
