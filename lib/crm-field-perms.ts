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

/**
 * Reglas de score que una persona puede ver en un desglose, por id: las de
 * actividad y las de propiedad sobre un campo que no tiene oculto. Una regla
 * que no está (sobre un campo oculto, o borrada) no sale ni por nombre ni por
 * puntos.
 */
export type VisibleScoreRules = ReadonlyMap<string, 'activity' | 'property'>;

/**
 * Campos ocultos de una entidad. Los de contactos llevan además las reglas de
 * score visibles (hiddenFieldsFor las carga), así cualquier fila con
 * `score_breakdown` que pasa por redactRow sale sin las reglas sobre campos
 * ocultos.
 */
export type HiddenFieldSet = Set<string> & {
  scoreRules?: VisibleScoreRules;
  /** Hay reglas de score sobre estos campos: el total y sus cambios pueden decir algo de ellos. */
  hidesScoreRules?: boolean;
};

const isActivityDetail = (d: unknown) => typeof d === 'string' && /^\d+ \/ \d+d$/.test(d);

/**
 * Desglose de score para una persona con campos ocultos. Con `rules` (las que
 * ve): solo esas reglas, y las de propiedad sin el detalle (es el valor del
 * campo). Sin `rules` (no se sabe sobre qué campo es cada una): solo las de
 * actividad. El detalle de una de actividad ("3 / 30d") queda. Puro.
 */
export function redactScoreBreakdown(json: string, rules?: VisibleScoreRules): string {
  try {
    const v: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(v)) return '[]';
    const out: unknown[] = [];
    for (const b of v) {
      if (!b || typeof b !== 'object') continue;
      const item = b as Record<string, unknown>;
      const kind = rules ? rules.get(typeof item.ruleId === 'string' ? item.ruleId : '') : isActivityDetail(item.detail) ? 'activity' : undefined;
      if (!kind) continue;
      out.push(kind === 'activity' ? item : { ...item, detail: '' });
    }
    return JSON.stringify(out);
  } catch {
    return '[]';
  }
}

/** Ítems de un desglose (ya parseado) que la persona ve: mismas reglas que redactScoreBreakdown. Puro. */
export function visibleBreakdownItems<T extends { ruleId: string; detail: string }>(items: T[], rules: VisibleScoreRules): T[] {
  return items.filter((b) => rules.has(b.ruleId)).map((b) => (rules.get(b.ruleId) === 'property' ? { ...b, detail: '' } : b));
}

/**
 * Puntos del desglose que la persona no ve (reglas sobre campos ocultos o que
 * no se pueden atribuir): se restan del total que se le muestra, así el total
 * no dice lo que el desglose calla. Puro.
 */
export function hiddenBreakdownPoints(items: unknown, rules: VisibleScoreRules | undefined): number {
  if (!Array.isArray(items)) return 0;
  let out = 0;
  for (const b of items) {
    if (!b || typeof b !== 'object') continue;
    const item = b as Record<string, unknown>;
    const kind = rules ? rules.get(typeof item.ruleId === 'string' ? item.ruleId : '') : isActivityDetail(item.detail) ? 'activity' : undefined;
    if (!kind) out += Number(item.points) || 0;
  }
  return out;
}

function parseItems(json: string): unknown {
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
}

/**
 * Copia de la fila sin los campos ocultos en `custom` (y, si la fila trae el
 * desglose del score, sin las reglas sobre campos ocultos ni el detalle de
 * las de propiedad).
 */
export function redactRow<T extends { custom: string }>(row: T, hidden: ReadonlySet<string>): T {
  if (!hidden.size) return row;
  const out = { ...row, custom: redactCustomJson(row.custom, hidden) };
  const sb = (row as { score_breakdown?: unknown }).score_breakdown;
  if (typeof sb === 'string') {
    const rules = (hidden as HiddenFieldSet).scoreRules;
    (out as { score_breakdown?: string }).score_breakdown = redactScoreBreakdown(sb, rules);
    // El total, sin los puntos de las reglas que no se muestran.
    const score = (row as { score?: unknown }).score;
    const minus = hiddenBreakdownPoints(parseItems(sb), rules);
    if (typeof score === 'number' && minus) (out as { score?: number }).score = score - minus;
  }
  return out;
}

/**
 * Reglas de score del workspace que ve quien tiene ocultos estos campos de
 * contacto: todas las de actividad y las de propiedad sobre otro campo.
 */
export async function visibleScoreRules(workspaceId: string, hidden: ReadonlySet<string>, db: Db = getDb()): Promise<Map<string, 'activity' | 'property'> & { anyHidden?: boolean }> {
  const rows = (await db.prepare('SELECT id, kind, config FROM crm_score_rules WHERE user_id = ?').all(workspaceId)) as Array<{
    id: string;
    kind: string;
    config: string;
  }>;
  const out: Map<string, 'activity' | 'property'> & { anyHidden?: boolean } = new Map();
  for (const r of rows) {
    if (r.kind === 'activity') {
      out.set(r.id, 'activity');
      continue;
    }
    let field = '';
    try {
      const cfg: unknown = JSON.parse(r.config || '{}');
      field = cfg && typeof cfg === 'object' && typeof (cfg as { field?: unknown }).field === 'string' ? (cfg as { field: string }).field : '';
    } catch {
      field = '';
    }
    // Sin campo legible no se sabe qué dice: no sale.
    if (!field || (field.startsWith('custom.') && hidden.has(field.slice(7)))) {
      out.anyHidden = true;
      continue;
    }
    out.set(r.id, 'property');
  }
  return out;
}

/** Entidades de custom fields de una ficha de contacto, empresa o deal. */
export type RecordFieldEntity = 'contacts' | 'companies' | 'deals';

/**
 * Claves de una ficha (getContact, getCompany, getDeal) que traen filas con
 * `custom`, y la entidad de sus campos: el registro y sus asociados.
 */
export const DETAIL_ENTITIES = {
  contact: { contact: 'contacts', company: 'companies', companies: 'companies', deals: 'deals' },
  company: { company: 'companies', contacts: 'contacts', deals: 'deals', children: 'companies' },
  deal: { deal: 'deals', contacts: 'contacts', company: 'companies', companies: 'companies' },
} as const satisfies Record<'contact' | 'company' | 'deal', Record<string, RecordFieldEntity>>;

function redactValue(v: unknown, hidden: ReadonlySet<string>): unknown {
  if (!hidden.size || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, hidden));
  const row = v as Record<string, unknown>;
  return typeof row.custom === 'string' ? redactRow(row as Record<string, unknown> & { custom: string }, hidden) : row;
}

/**
 * Ficha sin los campos ocultos en el `custom` del registro ni en el de sus
 * asociados (cada uno con las reglas de su entidad). Puro.
 */
export function redactDetailWith<T extends object>(
  kind: keyof typeof DETAIL_ENTITIES,
  detail: T,
  hidden: Partial<Record<RecordFieldEntity, ReadonlySet<string>>>,
): T {
  const out: Record<string, unknown> = { ...(detail as unknown as Record<string, unknown>) };
  for (const [key, entity] of Object.entries(DETAIL_ENTITIES[kind]) as Array<[string, RecordFieldEntity]>) {
    const set = hidden[entity];
    if (set?.size && key in out) out[key] = redactValue(out[key], set);
  }
  return out as unknown as T;
}

/** Campos ocultos para la persona en varias entidades a la vez. */
export async function hiddenFieldSets<E extends string>(
  viewer: FieldViewer,
  entities: readonly E[],
  db: Db = getDb(),
): Promise<Record<E, HiddenFieldSet>> {
  const out = {} as Record<E, HiddenFieldSet>;
  for (const e of new Set(entities)) out[e] = await hiddenFieldsFor(viewer, e, db);
  return out;
}

/** redactDetailWith con las reglas de la persona. */
export async function redactRecordDetail<T extends object>(
  viewer: FieldViewer,
  kind: keyof typeof DETAIL_ENTITIES,
  detail: T,
  db: Db = getDb(),
): Promise<T> {
  if (isUnrestricted(viewer)) return detail;
  return redactDetailWith(kind, detail, await hiddenFieldSets(viewer, ['contacts', 'companies', 'deals'] as const, db));
}

/**
 * Filas sin los campos ocultos para la persona en `custom`. Sirve para
 * cualquier lista de registros de una entidad (búsqueda, board, listas).
 */
export async function redactRowsFor<T extends { custom: string }>(
  viewer: FieldViewer,
  entity: string,
  rows: T[],
  db: Db = getDb(),
): Promise<T[]> {
  if (!rows.length || isUnrestricted(viewer)) return rows;
  const hidden = await hiddenFieldsFor(viewer, entity, db);
  return hidden.size ? rows.map((r) => redactRow(r, hidden)) : rows;
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
 * Dos definiciones con el mismo nombre en la misma entidad leen el mismo
 * valor (custom.<name>): cada una queda con el acceso más estricto de las
 * del nombre, así una copia sin reglas no abre un campo oculto o de solo
 * lectura (en filtros, orden, columnas o escrituras). Puro.
 */
export function byNameStrictest<T extends { entity: string; name: string; access: FieldAccess }>(defs: T[]): T[] {
  const strict = new Map<string, FieldAccess>();
  for (const d of defs) {
    const key = `${d.entity}\u0000${d.name}`;
    strict.set(key, strictest(strict.get(key) ?? 'edit', d.access));
  }
  return defs.map((d) => {
    const access = strict.get(`${d.entity}\u0000${d.name}`) ?? d.access;
    return access === d.access ? d : { ...d, access };
  });
}

/**
 * Campos propios de la entidad con el acceso de la persona. `all` incluye los
 * ocultos (para mezclar escrituras); `visible` los que se muestran.
 */
export async function fieldAccessFor(
  viewer: FieldViewer,
  entity: string,
  db: Db = getDb(),
): Promise<{ all: FieldWithAccess[]; visible: FieldWithAccess[]; hidden: HiddenFieldSet; restricted: Map<string, FieldRestriction> }> {
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
    all = byNameStrictest(defs.map((d) => ({ ...d, access: accessFor(rules.filter((r) => r.field_id === d.id), subjects) })));
  }
  const restricted = new Map<string, FieldRestriction>();
  for (const f of all) if (f.access !== 'edit') restricted.set(f.name, f.access);
  const hidden: HiddenFieldSet = new Set(all.filter((f) => f.access === 'hidden').map((f) => f.name));
  // Contactos: el desglose del score de cualquier fila sale sin las reglas sobre estos campos.
  if (entity === 'contacts' && hidden.size) {
    const rules = await visibleScoreRules(viewer.workspaceId, hidden, db);
    hidden.scoreRules = rules;
    hidden.hidesScoreRules = !!rules.anyHidden;
  }
  return {
    all,
    visible: all.filter((f) => f.access !== 'hidden'),
    hidden,
    restricted,
  };
}

/**
 * Definiciones de campos propios (de todas las entidades) que la persona puede
 * ver: owner y admins, todas; el resto, sin las que tiene ocultas. Mismo orden
 * que listCustomFields sin entidad. Es lo que listan GET /api/crm/custom-fields
 * sin entidad y Ajustes › Datos.
 */
export async function visibleFieldDefinitions(viewer: FieldViewer, db: Db = getDb()): Promise<CrmCustomFieldRow[]> {
  const defs = (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? ORDER BY entity ASC, position ASC')
    .all(viewer.workspaceId)) as CrmCustomFieldRow[];
  if (isUnrestricted(viewer) || !defs.length) return defs;
  const [rules, subjects] = await Promise.all([
    db
      .prepare('SELECT field_id, subject, access FROM crm_field_permissions WHERE user_id = ?')
      .all(viewer.workspaceId) as Promise<Array<Pick<CrmFieldPermissionRow, 'field_id' | 'subject' | 'access'>>>,
    viewerSubjects(viewer, db),
  ]);
  const byField = new Map<string, Array<Pick<CrmFieldPermissionRow, 'subject' | 'access'>>>();
  for (const r of rules) byField.set(r.field_id, [...(byField.get(r.field_id) ?? []), r]);
  return byNameStrictest(defs.map((d) => ({ ...d, access: accessFor(byField.get(d.id) ?? [], subjects) })))
    .filter((d) => d.access !== 'hidden')
    .map(({ access: _a, ...d }) => d as CrmCustomFieldRow);
}

/** Acceso de la persona a un campo propio. null si el campo no es del workspace. */
export async function fieldDefinitionAccess(viewer: FieldViewer, fieldId: string, db: Db = getDb()): Promise<FieldAccess | null> {
  const row = (await db
    .prepare('SELECT entity FROM crm_custom_fields WHERE id = ? AND user_id = ?')
    .get(fieldId, viewer.workspaceId)) as { entity: string } | undefined;
  if (!row) return null;
  if (isUnrestricted(viewer)) return 'edit';
  const { all } = await fieldAccessFor(viewer, row.entity, db);
  return all.find((f) => f.id === fieldId)?.access ?? null;
}

/** ¿La persona puede ver la definición del campo? false si no es del workspace o lo tiene oculto. */
export async function canSeeFieldDefinition(viewer: FieldViewer, fieldId: string, db: Db = getDb()): Promise<boolean> {
  const access = await fieldDefinitionAccess(viewer, fieldId, db);
  return access !== null && access !== 'hidden';
}

/**
 * Campos propios de la entidad que algún rol o equipo tiene ocultos: lo que
 * no puede ir en algo que lee cualquiera que ve el registro (una nota, un
 * email registrado en el timeline).
 */
export async function fieldsHiddenForAnyone(workspaceId: string, entity: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT f.name FROM crm_field_permissions p JOIN crm_custom_fields f ON f.id = p.field_id
       WHERE p.user_id = ? AND f.user_id = ? AND p.access = 'hidden' AND f.entity = ?`,
    )
    .all(workspaceId, workspaceId, entity)) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** Campos ocultos para la persona en la entidad (para redactar filas; en contactos, con las reglas de score que ve). */
export async function hiddenFieldsFor(viewer: FieldViewer, entity: string, db: Db = getDb()): Promise<HiddenFieldSet> {
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
