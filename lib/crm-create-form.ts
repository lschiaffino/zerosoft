/**
 * CRM — formulario de alta configurable (HubSpot "Manage create form").
 * Server-only. Lo puro (catálogo, limpieza, obligatorios) está en
 * lib/crm-create-form-shared.ts.
 *
 * Privacidad: el formulario que recibe cada persona sale de las definiciones
 * que puede editar (lib/crm-field-perms.ts). Una propiedad personalizada que
 * tiene oculta o de solo lectura no aparece en su alta ni se le exige, aunque
 * esté configurada.
 */
import { getDb, type CrmCustomFieldRow, type Db } from './db';
import { fieldAccessFor, isUnrestricted, sessionFieldViewer, type FieldViewer } from './crm-field-perms';
import { fieldOptions } from './crm-custom-fields';
import { getCrmSettings } from './crm-currency';
import { isWorkspaceAdmin, realUserId, type SessionUser } from './session';
import { listMembers } from './teams';
import { workspaceTeamId } from './workspace';
import {
  BUILTIN_FIELDS,
  customKey,
  customName,
  DEFAULT_CREATE_FORM,
  missingRequired,
  sanitizeCreateForm,
  type CreateFormEntity,
  type CreateFormField,
  type ResolvedCreateField,
} from './crm-create-form-shared';

function parseFields(json: string | null | undefined): Array<{ key: unknown; required?: unknown }> {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<{ key: unknown; required?: unknown }>) : [];
  } catch {
    return [];
  }
}

async function customDefs(workspaceId: string, entity: CreateFormEntity, db: Db): Promise<CrmCustomFieldRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? AND entity = ? ORDER BY position ASC, label ASC')
    .all(workspaceId, entity)) as CrmCustomFieldRow[];
}

/**
 * Configuración guardada del objeto (o la de por defecto), sin claves que ya
 * no existen (una propiedad personalizada borrada). Sin filtrar por persona:
 * es lo que edita Ajustes (owner/admin).
 */
export async function getCreateForm(workspaceId: string, entity: CreateFormEntity, db: Db = getDb()): Promise<CreateFormField[]> {
  const row = (await db
    .prepare('SELECT fields FROM crm_create_forms WHERE user_id = ? AND entity = ?')
    .get(workspaceId, entity)) as { fields: string } | undefined;
  if (!row) return DEFAULT_CREATE_FORM[entity].map((f) => ({ ...f }));
  const defs = await customDefs(workspaceId, entity, db);
  return sanitizeCreateForm(entity, parseFields(row.fields), new Map(defs.map((d) => [d.name, d.type])));
}

/** Guarda la configuración (la ruta exige owner/admin). Devuelve lo guardado, ya limpio. */
export async function setCreateForm(
  workspaceId: string,
  entity: CreateFormEntity,
  fields: ReadonlyArray<{ key: unknown; required?: unknown }>,
  db: Db = getDb(),
): Promise<CreateFormField[]> {
  const defs = await customDefs(workspaceId, entity, db);
  const clean = sanitizeCreateForm(entity, fields, new Map(defs.map((d) => [d.name, d.type])));
  await db
    .prepare(
      `INSERT INTO crm_create_forms (user_id, entity, fields, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, entity) DO UPDATE SET fields = excluded.fields, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, entity, JSON.stringify(clean));
  return clean;
}

/** Vuelve al formulario por defecto. */
export async function resetCreateForm(workspaceId: string, entity: CreateFormEntity, db: Db = getDb()): Promise<void> {
  await db.prepare('DELETE FROM crm_create_forms WHERE user_id = ? AND entity = ?').run(workspaceId, entity);
}

/**
 * El formulario de alta para esta persona: la configuración sin las
 * propiedades personalizadas que no puede editar, con su definición.
 */
export async function resolveCreateForm(
  viewer: FieldViewer,
  entity: CreateFormEntity,
  db: Db = getDb(),
): Promise<ResolvedCreateField[]> {
  const form = await getCreateForm(viewer.workspaceId, entity, db);
  if (!form.some((f) => customName(f.key))) return form;
  const editable = isUnrestricted(viewer)
    ? await customDefs(viewer.workspaceId, entity, db)
    : (await fieldAccessFor(viewer, entity, db)).all.filter((f) => f.access === 'edit');
  const byKey = new Map(editable.map((d) => [customKey(d.name), d]));
  const out: ResolvedCreateField[] = [];
  for (const f of form) {
    if (!customName(f.key)) {
      out.push(f);
      continue;
    }
    const def = byKey.get(f.key);
    if (!def) continue;
    out.push({
      key: f.key,
      required: f.required,
      custom: {
        name: def.name,
        label: def.label,
        type: def.type,
        options: fieldOptions(def),
        ...(def.description ? { description: def.description } : {}),
      },
    });
  }
  return out;
}

/**
 * El resto de lo que la persona puede cargar al crear (para "Más campos" del
 * formulario completo): las propiedades propias y personalizadas editables
 * que no están en el formulario configurado. Ninguna es obligatoria.
 */
export async function moreCreateFields(
  viewer: FieldViewer,
  entity: CreateFormEntity,
  form: ReadonlyArray<ResolvedCreateField>,
  db: Db = getDb(),
): Promise<ResolvedCreateField[]> {
  const inForm = new Set(form.map((f) => f.key));
  const editable = isUnrestricted(viewer)
    ? await customDefs(viewer.workspaceId, entity, db)
    : (await fieldAccessFor(viewer, entity, db)).all.filter((f) => f.access === 'edit');
  return [
    ...BUILTIN_FIELDS[entity].filter((b) => !inForm.has(b.key)).map((b) => ({ key: b.key, required: false })),
    ...editable
      .filter((d) => !inForm.has(customKey(d.name)))
      .map((d) => ({
        key: customKey(d.name),
        required: false,
        custom: {
          name: d.name,
          label: d.label,
          type: d.type,
          options: fieldOptions(d),
          ...(d.description ? { description: d.description } : {}),
        },
      })),
  ];
}

/** Lo que necesita un formulario de alta: propiedades, personas, quién es y la moneda base. */
export async function createFormData(
  user: SessionUser,
  entity: CreateFormEntity,
  opts: { more?: boolean } = {},
): Promise<{
  fields: ResolvedCreateField[];
  more: ResolvedCreateField[];
  people: Array<{ value: string; label: string }>;
  me: string;
  baseCurrency: string;
  canEdit: boolean;
}> {
  const viewer = sessionFieldViewer(user);
  const teamId = workspaceTeamId(user);
  const [fields, members, settings] = await Promise.all([
    resolveCreateForm(viewer, entity),
    teamId ? listMembers(teamId) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
    getCrmSettings(user.id),
  ]);
  return {
    fields,
    more: opts.more ? await moreCreateFields(viewer, entity, fields) : [],
    people: members.map((m) => ({ value: m.user_id, label: m.name || m.email })),
    me: realUserId(user),
    baseCurrency: settings.baseCurrency,
    canEdit: isWorkspaceAdmin(user),
  };
}

/**
 * Obligatorias vacías de un alta desde la app. `body` es lo que se va a
 * guardar (custom ya pasado por los permisos). Devuelve las claves y las
 * etiquetas de las personalizadas que faltan (solo de lo que la persona ve).
 */
export async function createFormMissing(
  viewer: FieldViewer,
  entity: CreateFormEntity,
  body: Record<string, unknown>,
  db: Db = getDb(),
): Promise<{ fields: string[]; labels: Record<string, string> }> {
  const form = await resolveCreateForm(viewer, entity, db);
  const fields = missingRequired(entity, form, body);
  const labels: Record<string, string> = {};
  for (const key of fields) {
    const def = form.find((f) => f.key === key)?.custom;
    if (def) labels[key] = def.label;
  }
  return { fields, labels };
}
