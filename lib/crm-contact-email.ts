/**
 * CRM — el email como identidad del contacto. Server-only.
 *
 * La regla, en un solo lugar: dentro de un workspace, dos contactos vivos no
 * comparten email (sin distinguir mayúsculas ni espacios alrededor). Un email
 * vacío no cuenta: puede haber muchos contactos sin email.
 *
 * Cómo se hace cumplir:
 * - createContact y updateContact (lib/crm.ts) escriben con un NOT EXISTS en
 *   la misma sentencia: dos altas a la vez con el mismo email no pasan las
 *   dos. Si el email está tomado tiran ContactEmailTakenError.
 * - Todavía NO hay índice único: producción puede tener duplicados de antes
 *   y un índice único fallaría al crearse. El índice de
 *   20261119_0836_crm_contacts_email_key no es único (solo acelera la
 *   búsqueda). Cuando la vista Duplicados quede vacía en todos los
 *   workspaces se puede sumar el único parcial (WHERE trim(email) != '').
 * - Duplicados que ya existían: no se tocan solos. Editar otro campo de uno
 *   de ellos sigue andando (solo se chequea cuando el email cambia). Se
 *   listan en Contactos › Duplicados y se fusionan a mano (mergeContacts).
 * - Papelera: borrar un contacto saca su fila de crm_contacts
 *   (lib/crm-trash.ts), así que no bloquea un alta con el mismo email.
 *   Restaurar uno cuyo email ya tomó un contacto vivo se rechaza
 *   ('email_taken'): la entrada queda en la papelera hasta que el email se
 *   libere (cambiándolo o borrando el otro contacto).
 * - Emails secundarios: el modelo no los tiene (crm_contacts.email es el
 *   único); cuando existan entran en EMAIL_KEY y en estas búsquedas.
 *
 * La comparación la hace siempre SQLite (lower(trim(email)) contra
 * lower(trim(?))) para que los dos lados normalicen igual.
 */
import { getDb, type CrmContactRow, type Db } from './db';
import { canSeeOwner, ownerScopeSql, type OwnerScope } from './crm-visibility';

/** Código estable del error (rutas session, API v1, flows, asistente). */
export const CONTACT_EMAIL_TAKEN = 'contact_email_taken';

/** Clave de comparación de la columna email de `alias` ('' = sin alias). */
export function emailKeySql(alias = ''): string {
  return `lower(trim(${alias ? `${alias}.` : ''}email))`;
}

/** Email como se guarda: sin espacios alrededor (las mayúsculas se respetan). */
export function cleanContactEmail(email: string | null | undefined): string {
  return (email ?? '').trim();
}

/** ¿Los dos emails son el mismo para la regla? (decide si un update cambia el email). */
export function sameContactEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return cleanContactEmail(a).toLowerCase() === cleanContactEmail(b).toLowerCase();
}

/** Ya hay un contacto vivo con ese email en el workspace. */
export class ContactEmailTakenError extends Error {
  readonly code = CONTACT_EMAIL_TAKEN;
  constructor(readonly existing: CrmContactRow) {
    super(CONTACT_EMAIL_TAKEN);
    this.name = 'ContactEmailTakenError';
  }
}

/**
 * Contacto vivo del workspace con ese email (el más antiguo si ya había
 * duplicados). `exceptId` lo saca de la búsqueda (para editar un contacto).
 */
export async function findContactByEmail(
  userId: string,
  email: string | null | undefined,
  db: Db = getDb(),
  exceptId?: string,
): Promise<CrmContactRow | null> {
  const clean = cleanContactEmail(email);
  if (!clean) return null;
  const row = (await db
    .prepare(
      `SELECT * FROM crm_contacts
       WHERE user_id = ? AND ${emailKeySql()} = lower(trim(?))${exceptId ? ' AND id != ?' : ''}
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
    .get(userId, clean, ...(exceptId ? [exceptId] : []))) as CrmContactRow | undefined;
  return row ?? null;
}

/** Lo que se le puede mostrar de un contacto existente a quien choca con él. */
export interface EmailTakenInfo {
  /** null = existe pero quien pregunta no lo ve: ni id, ni nombre. */
  existing: { id: string; name: string } | null;
}

/**
 * Respeta la visibilidad por owner (lib/crm-visibility.ts): si la persona no
 * ve el contacto existente, solo se le dice que existe.
 */
export function emailTakenInfo(existing: CrmContactRow, scope: OwnerScope | undefined): EmailTakenInfo {
  if (!canSeeOwner(scope, existing.owner_id, existing.user_id)) return { existing: null };
  const name = `${existing.first_name} ${existing.last_name}`.trim() || existing.email;
  return { existing: { id: existing.id, name } };
}

/**
 * Resuelve la promesa; si falló porque el email está tomado devuelve el error
 * como valor (igual que catchRef con las referencias inválidas).
 */
export async function catchEmailTaken<T>(p: Promise<T>): Promise<T | ContactEmailTakenError> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ContactEmailTakenError) return e;
    throw e;
  }
}

/**
 * Condición SQL (para un WHERE) que solo deja escribir si ningún otro contacto
 * vivo del workspace tiene ese email. Va en la misma sentencia que el INSERT o
 * el UPDATE para que el chequeo y la escritura sean una sola operación.
 */
export function emailFreeSql(userId: string, email: string, exceptIds: string[] = []): { sql: string; args: string[] } {
  const except = exceptIds.length ? ` AND o.id NOT IN (${exceptIds.map(() => '?').join(',')})` : '';
  return {
    sql: `NOT EXISTS (SELECT 1 FROM crm_contacts o WHERE o.user_id = ?${except} AND ${emailKeySql('o')} = lower(trim(?)))`,
    args: [userId, ...exceptIds, email],
  };
}

// ---------- Duplicados que ya existen ----------

export interface DuplicateGroup {
  email: string;
  contacts: CrmContactRow[];
}

export interface DuplicateFilter {
  /** Solo lo que ve quien pide; un grupo con menos de dos visibles no se lista. */
  ownerScope?: OwnerScope;
  /** Solo el grupo que incluye a este contacto. */
  contactId?: string;
}

/** Tope de filas por listado: la vista es para limpiar de a grupos, no un export. */
const DUPLICATE_ROWS_MAX = 1000;

/**
 * Grupos de contactos vivos que comparten email (email no vacío, más de uno),
 * el más antiguo primero en cada grupo. Una sola consulta.
 */
export async function findDuplicateContacts(
  userId: string,
  filter: DuplicateFilter = {},
  db: Db = getDb(),
): Promise<DuplicateGroup[]> {
  const scope = ownerScopeSql('c', filter.ownerScope);
  // El contacto pedido también tiene que verse: si no, se responde como si no tuviera duplicados.
  const mine = ownerScopeSql('m', filter.ownerScope);
  const only = filter.contactId
    ? ` AND ${emailKeySql('c')} = (SELECT ${emailKeySql('m')} FROM crm_contacts m WHERE m.id = ? AND m.user_id = ?${mine.sql ? ` AND ${mine.sql}` : ''})`
    : '';
  const rows = (await db
    .prepare(
      `SELECT c.*, ${emailKeySql('c')} AS email_key FROM crm_contacts c
       WHERE c.user_id = ? AND trim(c.email) != ''${scope.sql ? ` AND ${scope.sql}` : ''}${only}
         AND ${emailKeySql('c')} IN (
           SELECT ${emailKeySql('d')} FROM crm_contacts d
           WHERE d.user_id = ? AND trim(d.email) != ''
           GROUP BY 1 HAVING COUNT(*) > 1)
       ORDER BY ${emailKeySql('c')} ASC, c.created_at ASC, c.id ASC
       LIMIT ${DUPLICATE_ROWS_MAX}`,
    )
    .all(userId, ...scope.args, ...(filter.contactId ? [filter.contactId, userId, ...mine.args] : []), userId)) as Array<
    CrmContactRow & { email_key?: string }
  >;
  const groups = new Map<string, CrmContactRow[]>();
  for (const { email_key: emailKey, ...row } of rows) {
    const key = emailKey ?? row.email.trim().toLowerCase();
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .filter(([, contacts]) => contacts.length > 1)
    .map(([email, contacts]) => ({ email, contacts }))
    .sort((a, b) => b.contacts.length - a.contacts.length || a.email.localeCompare(b.email));
}
