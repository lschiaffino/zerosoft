/**
 * CRM — permisos por campo (propiedades propias). Server-only salvo las
 * funciones puras de arriba, que también testean los unitarios.
 *
 * El admin marca un campo propio como "solo lectura" u "oculto" para el rol
 * member o para un equipo de ventas (crm_sales_teams). Owner y admins siempre
 * ven y editan todo. Si a una persona le tocan varias reglas gana la más
 * estricta (oculto > solo lectura).
 *
 * Se aplica en tres lugares:
 * - Lectura: las páginas y la API quitan del JSON `custom` los campos ocultos
 *   (redactRow) y no los listan como columnas ni filtros (customFieldsFor).
 * - Escritura: mergeCustomWrite conserva el valor guardado de los campos que
 *   la persona no puede editar y rechaza el cambio de uno de solo lectura.
 * - UI: PropertiesPanel muestra los de solo lectura sin botón de editar.
 */
import { getDb, type CrmCustomFieldRow, type CrmFieldPermissionRow, type Db } from './db';
import { roleAtLeast, type TeamRole } from './teams';

export type FieldAccess = 'edit' | 'read' | 'hidden';
export type FieldRestriction = 'read' | 'hidden';

export interface FieldViewer {
  workspaceId: string;
  personId: string;
  role: TeamRole;
}

/** Sujeto de una regla: el rol member o un equipo de ventas. */
export const MEMBER_SUBJECT = 'role:member';
const SUBJECT_RE = /^(role:member|team:[A-Za-z0-9_-]{1,64})$/;

export function isFieldSubject(v: unknown): v is string {
  return typeof v === 'string' && SUBJECT_RE.test(v);
}

const RANK: Record<FieldAccess, number> = { edit: 0, read: 1, hidden: 2 };

/** La más estricta de dos. */
export function strictest(a: FieldAccess, b: FieldAccess): FieldAccess {
  return RANK[a] >= RANK[b] ? a : b;
}

/** ¿Las reglas aplican a esta persona? Owner/admin nunca tienen restricciones. */
export function isUnrestricted(viewer: Pick<FieldViewer, 'role' | 'personId' | 'workspaceId'>): boolean {
  return roleAtLeast(viewer.role, 'admin') || viewer.personId === viewer.workspaceId;
}

/** Acceso a un campo según sus reglas y los sujetos de la persona. Puro. */
export function accessFor(
  rules: Array<Pick<CrmFieldPermissionRow, 'subject' | 'access'>>,
  subjects: ReadonlySet<string>,
): FieldAccess {
  let out: FieldAccess = 'edit';
  for (const r of rules) if (subjects.has(r.subject)) out = strictest(out, r.access);
  return out;
}

/**
 * Mezcla el `custom` que llega con el guardado: los campos que la persona no
 * edita conservan su valor (aunque el cliente los omita, como hace el panel
 * de propiedades con los ocultos). Cambiar uno de solo lectura es un error.
 * Puro.
 */
export function mergeCustomWrite(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  restricted: ReadonlyMap<string, FieldRestriction>,
): { ok: true; custom: Record<string, unknown> } | { ok: false; field: string } {
  const out: Record<string, unknown> = { ...incoming };
  for (const [name, access] of restricted) {
    const has = Object.prototype.hasOwnProperty.call(incoming, name);
    if (access === 'read' && has && !sameValue(incoming[name], existing[name])) return { ok: false, field: name };
    if (existing[name] === undefined) delete out[name];
    else out[name] = existing[name];
  }
  return { ok: true, custom: out };
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Saca del JSON `custom` los campos ocultos. Puro. */
export function redactCustomJson(json: string | null | undefined, hidden: ReadonlySet<string>): string {
  if (!hidden.size) return json ?? '{}';
  try {
    const v: unknown = JSON.parse(json || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return '{}';
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!hidden.has(k)) out[k] = val;
    return JSON.stringify(out);
  } catch {
    return '{}';
  }
}

/** Copia de la fila sin los campos ocultos en `custom`. */
export function redactRow<T extends { custom: string }>(row: T, hidden: ReadonlySet<string>): T {
  return hidden.size ? { ...row, custom: redactCustomJson(row.custom, hidden) } : row;
}

// ---------- Server ----------

/** Persona de la sesión (lib/session.ts). */
export function sessionFieldViewer(user: { id: string; role: TeamRole; actingUser?: { id: string } | null }): FieldViewer {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role };
}

/** API key: actúa como la persona que la creó. */
export function apiFieldViewer(auth: { user: { id: string }; personId: string; role: TeamRole }): FieldViewer {
  return { workspaceId: auth.user.id, personId: auth.personId, role: auth.role };
}

/** Sujetos de la persona: el rol member y sus equipos de ventas. */
export async function viewerSubjects(viewer: FieldViewer, db: Db = getDb()): Promise<Set<string>> {
  const teams = (await db
    .prepare('SELECT team_id FROM crm_sales_team_members WHERE user_id = ? AND person_id = ?')
    .all(viewer.workspaceId, viewer.personId)) as Array<{ team_id: string }>;
  return new Set([MEMBER_SUBJECT, ...teams.map((t) => `team:${t.team_id}`)]);
}

export async function listFieldPermissions(workspaceId: string, db: Db = getDb()): Promise<CrmFieldPermissionRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_field_permissions WHERE user_id = ? ORDER BY created_at ASC')
    .all(workspaceId)) as CrmFieldPermissionRow[];
}

/** Reemplaza las reglas de un campo. false si el campo no es del workspace o un equipo no existe. */
export async function setFieldPermissions(
  workspaceId: string,
  fieldId: string,
  rules: Array<{ subject: string; access: FieldRestriction }>,
  db: Db = getDb(),
): Promise<boolean> {
  const field = await db.prepare('SELECT 1 FROM crm_custom_fields WHERE id = ? AND user_id = ?').get(fieldId, workspaceId);
  if (!field) return false;
  const teamIds = rules.filter((r) => r.subject.startsWith('team:')).map((r) => r.subject.slice(5));
  for (const teamId of new Set(teamIds)) {
    if (!(await db.prepare('SELECT 1 FROM crm_sales_teams WHERE id = ? AND user_id = ?').get(teamId, workspaceId))) return false;
  }
  await db.prepare('DELETE FROM crm_field_permissions WHERE field_id = ? AND user_id = ?').run(fieldId, workspaceId);
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.subject)) continue;
    seen.add(r.subject);
    await db
      .prepare('INSERT INTO crm_field_permissions (id, user_id, field_id, subject, access) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), workspaceId, fieldId, r.subject, r.access);
  }
  return true;
}

/** Al borrar un campo (o su objeto) se van sus reglas. */
export async function deleteFieldPermissions(workspaceId: string, fieldIds: string[], db: Db = getDb()): Promise<void> {
  for (const id of fieldIds) {
    await db.prepare('DELETE FROM crm_field_permissions WHERE field_id = ? AND user_id = ?').run(id, workspaceId);
  }
}

export type FieldWithAccess = CrmCustomFieldRow & { access: FieldAccess };

/**
 * Campos propios de la entidad con el acceso de la persona. `all` incluye los
 * ocultos (para mezclar escrituras); `visible` los que se muestran.
 */
export async function fieldAccessFor(
  viewer: FieldViewer,
  entity: string,
  db: Db = getDb(),
): Promise<{ all: FieldWithAccess[]; visible: FieldWithAccess[]; hidden: Set<string>; restricted: Map<string, FieldRestriction> }> {
  const defs = (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? AND entity = ? ORDER BY position ASC, label ASC')
    .all(viewer.workspaceId, entity)) as CrmCustomFieldRow[];
  let all: FieldWithAccess[];
  if (isUnrestricted(viewer) || !defs.length) {
    all = defs.map((d) => ({ ...d, access: 'edit' as const }));
  } else {
    const [rules, subjects] = await Promise.all([
      db
        .prepare(
          `SELECT p.field_id, p.subject, p.access FROM crm_field_permissions p
           JOIN crm_custom_fields f ON f.id = p.field_id
           WHERE p.user_id = ? AND f.entity = ?`,
        )
        .all(viewer.workspaceId, entity) as Promise<Array<Pick<CrmFieldPermissionRow, 'field_id' | 'subject' | 'access'>>>,
      viewerSubjects(viewer, db),
    ]);
    all = defs.map((d) => ({ ...d, access: accessFor(rules.filter((r) => r.field_id === d.id), subjects) }));
  }
  const restricted = new Map<string, FieldRestriction>();
  for (const f of all) if (f.access !== 'edit') restricted.set(f.name, f.access);
  return {
    all,
    visible: all.filter((f) => f.access !== 'hidden'),
    hidden: new Set(all.filter((f) => f.access === 'hidden').map((f) => f.name)),
    restricted,
  };
}

/** Campos ocultos para la persona en la entidad (para redactar filas). */
export async function hiddenFieldsFor(viewer: FieldViewer, entity: string, db: Db = getDb()): Promise<Set<string>> {
  if (isUnrestricted(viewer)) return new Set();
  return (await fieldAccessFor(viewer, entity, db)).hidden;
}

/**
 * Aplica los permisos a una escritura de `custom` (alta o edición). Devuelve
 * el custom a guardar, o el nombre del campo de solo lectura que se quiso cambiar.
 */
export async function guardCustomWrite(
  viewer: FieldViewer,
  entity: string,
  existingJson: string | null,
  incoming: Record<string, unknown> | undefined,
  db: Db = getDb(),
): Promise<{ ok: true; custom: Record<string, unknown> | undefined } | { ok: false; field: string }> {
  if (incoming === undefined || isUnrestricted(viewer)) return { ok: true, custom: incoming };
  const { restricted } = await fieldAccessFor(viewer, entity, db);
  if (!restricted.size) return { ok: true, custom: incoming };
  let existing: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(existingJson || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) existing = v as Record<string, unknown>;
  } catch {
    existing = {};
  }
  return mergeCustomWrite(existing, incoming, restricted);
}

/** Entidad de custom fields de cada tipo de registro. */
export const FIELD_ENTITY = { contact: 'contacts', company: 'companies', deal: 'deals', lead: 'leads' } as const;

const ENTITY_TABLE = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' } as const;

/**
 * guardCustomWrite para contactos, empresas y deals: lee el custom guardado
 * del registro (`id` null = alta).
 */
export async function guardRecordCustomWrite(
  viewer: FieldViewer,
  kind: keyof typeof ENTITY_TABLE,
  id: string | null,
  incoming: Record<string, unknown> | undefined,
  db: Db = getDb(),
): Promise<{ ok: true; custom: Record<string, unknown> | undefined } | { ok: false; field: string }> {
  if (incoming === undefined || isUnrestricted(viewer)) return { ok: true, custom: incoming };
  const row = id
    ? ((await db.prepare(`SELECT custom FROM ${ENTITY_TABLE[kind]} WHERE id = ? AND user_id = ?`).get(id, viewer.workspaceId)) as
        | { custom: string }
        | undefined)
    : undefined;
  return guardCustomWrite(viewer, FIELD_ENTITY[kind], row?.custom ?? '{}', incoming, db);
}
