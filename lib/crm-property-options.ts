/**
 * CRM: opciones editables de Lifecycle stage y Lead status del workspace
 * (Ajustes › Datos › Opciones de propiedades). Server-only.
 *
 * Sin filas para una propiedad, el workspace usa las de fábrica. La primera
 * edición las copia a crm_property_options y desde ahí manda la tabla. Las
 * claves no cambian nunca: renombrar cambia solo el nombre y archivar solo la
 * esconde de los selectores (los registros que la tienen la siguen mostrando).
 */
import { getDb, type Db } from './db';
import { CrmRefError } from './crm-refs';
import {
  BUILTIN_OPTIONS,
  defaultOptions,
  defaultOptionSets,
  isAllowedOption,
  MAX_OPTION_LABEL,
  MAX_OPTIONS,
  OPTION_PROPERTIES,
  optionHelpers,
  type OptionHelpers,
  type OptionProperty,
  type OptionSets,
  type PropertyOption,
} from './crm-property-options-shared';

export * from './crm-property-options-shared';

interface OptionRow {
  property: string;
  value: string;
  label: string;
  position: number;
  archived: number;
  builtin: number;
}

function toOption(r: OptionRow): PropertyOption {
  return { value: r.value, label: r.label ? r.label : null, archived: !!r.archived, builtin: !!r.builtin };
}

/** Las opciones del workspace, por propiedad y en su orden. */
export async function listOptionSets(ws: string, db: Db = getDb()): Promise<OptionSets> {
  const rows = (await db
    .prepare('SELECT property, value, label, position, archived, builtin FROM crm_property_options WHERE user_id = ? ORDER BY position ASC, created_at ASC, value ASC')
    .all(ws)) as OptionRow[];
  const sets = defaultOptionSets();
  for (const prop of OPTION_PROPERTIES) {
    const own = rows.filter((r) => r.property === prop);
    if (own.length) sets[prop] = own.map(toOption);
  }
  return sets;
}

export async function listOptions(ws: string, prop: OptionProperty, db: Db = getDb()): Promise<PropertyOption[]> {
  return (await listOptionSets(ws, db))[prop];
}

/** Copia las de fábrica a la tabla la primera vez que el workspace edita esa propiedad. */
async function materialize(ws: string, prop: OptionProperty, db: Db): Promise<void> {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO crm_property_options (user_id, property, value, label, position, archived, builtin)
     VALUES (?, ?, ?, '', ?, 0, 1)`,
  );
  const any = await db.prepare('SELECT 1 FROM crm_property_options WHERE user_id = ? AND property = ? LIMIT 1').get(ws, prop);
  if (any) return;
  let i = 0;
  for (const o of defaultOptions(prop)) await ins.run(ws, prop, o.value, i++);
}

export class OptionError extends Error {
  constructor(public code: 'option_not_found' | 'option_limit' | 'option_duplicate' | 'option_last_active' | 'invalid_input') {
    super(code);
    this.name = 'OptionError';
  }
}

function cleanLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION_LABEL);
}

/** ¿Hay otra opción (activa o archivada) que ya se llama así? Las de fábrica sin renombrar se comparan por su clave. */
function nameTaken(options: PropertyOption[], label: string, except?: string): boolean {
  const l = label.toLowerCase();
  return options.some((o) => o.value !== except && (o.label ?? '').toLowerCase() === l);
}

function newValue(): string {
  return `opt_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** Agrega una opción al final. */
export async function addOption(ws: string, prop: OptionProperty, label: string, db: Db = getDb()): Promise<PropertyOption> {
  const name = cleanLabel(label);
  if (!name) throw new OptionError('invalid_input');
  await materialize(ws, prop, db);
  const options = await listOptions(ws, prop, db);
  if (options.length >= MAX_OPTIONS) throw new OptionError('option_limit');
  if (nameTaken(options, name)) throw new OptionError('option_duplicate');
  const value = newValue();
  const pos = (await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM crm_property_options WHERE user_id = ? AND property = ?')
    .get(ws, prop)) as { n: number };
  await db
    .prepare(
      `INSERT INTO crm_property_options (user_id, property, value, label, position, archived, builtin)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
    )
    .run(ws, prop, value, name, Number(pos.n) || 0);
  return { value, label: name, archived: false, builtin: false };
}

/**
 * Renombra o archiva/restaura. En una de fábrica, nombre vacío vuelve al
 * traducido. No se puede archivar la última activa.
 */
export async function updateOption(
  ws: string,
  prop: OptionProperty,
  value: string,
  patch: { label?: string; archived?: boolean },
  db: Db = getDb(),
): Promise<PropertyOption> {
  await materialize(ws, prop, db);
  const options = await listOptions(ws, prop, db);
  const current = options.find((o) => o.value === value);
  if (!current) throw new OptionError('option_not_found');
  let label = current.label ?? '';
  if (patch.label !== undefined) {
    const name = cleanLabel(patch.label);
    if (!name && !current.builtin) throw new OptionError('invalid_input');
    if (name && nameTaken(options, name, value)) throw new OptionError('option_duplicate');
    label = name;
  }
  let archived = current.archived;
  if (patch.archived !== undefined) {
    if (patch.archived && !current.archived && options.filter((o) => !o.archived).length <= 1) {
      throw new OptionError('option_last_active');
    }
    archived = patch.archived;
  }
  await db
    .prepare(
      `UPDATE crm_property_options SET label = ?, archived = ?, updated_at = datetime('now')
       WHERE user_id = ? AND property = ? AND value = ?`,
    )
    .run(label, archived ? 1 : 0, ws, prop, value);
  return { ...current, label: label || null, archived };
}

/** Nuevo orden: `values` tiene que ser exactamente las opciones de la propiedad. */
export async function reorderOptions(ws: string, prop: OptionProperty, values: string[], db: Db = getDb()): Promise<PropertyOption[]> {
  await materialize(ws, prop, db);
  const options = await listOptions(ws, prop, db);
  const have = new Set(options.map((o) => o.value));
  if (values.length !== have.size || new Set(values).size !== values.length || values.some((v) => !have.has(v))) {
    throw new OptionError('invalid_input');
  }
  const upd = db.prepare(`UPDATE crm_property_options SET position = ?, updated_at = datetime('now') WHERE user_id = ? AND property = ? AND value = ?`);
  for (let i = 0; i < values.length; i++) await upd.run(i, ws, prop, values[i]);
  return listOptions(ws, prop, db);
}

/** Cuántos registros del workspace tienen cada valor (contactos + empresas en lifecycle; deals en deal type). */
export async function optionUsage(ws: string, prop: OptionProperty, db: Db = getDb()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const add = (rows: Array<{ v: string; n: number }>) => {
    for (const r of rows) out[r.v] = (out[r.v] ?? 0) + Number(r.n);
  };
  if (prop === 'lifecycle') {
    add((await db.prepare('SELECT lifecycle_stage AS v, COUNT(*) AS n FROM crm_contacts WHERE user_id = ? GROUP BY lifecycle_stage').all(ws)) as Array<{ v: string; n: number }>);
    add((await db.prepare('SELECT lifecycle_stage AS v, COUNT(*) AS n FROM crm_companies WHERE user_id = ? GROUP BY lifecycle_stage').all(ws)) as Array<{ v: string; n: number }>);
  } else if (prop === 'leadStatus') {
    add((await db.prepare('SELECT lead_status AS v, COUNT(*) AS n FROM crm_contacts WHERE user_id = ? GROUP BY lead_status').all(ws)) as Array<{ v: string; n: number }>);
  } else {
    add((await db.prepare("SELECT deal_type AS v, COUNT(*) AS n FROM crm_deals WHERE user_id = ? AND deal_type <> '' GROUP BY deal_type").all(ws)) as Array<{ v: string; n: number }>);
  }
  return out;
}

/**
 * Chequeo de escritura: lifecycle, lead status y deal type tienen que ser una
 * opción activa del workspace, o el valor que el registro ya tenía. Un deal
 * type '' (sin elegir) siempre vale. CrmRefError ('invalid_option') si no (las
 * rutas lo devuelven como 400).
 */
export async function assertOptionValues(
  ws: string,
  data: { lifecycleStage?: string | null; leadStatus?: string | null; dealType?: string | null },
  existing: { lifecycle_stage?: string | null; lead_status?: string | null; deal_type?: string | null } | null = null,
  db: Db = getDb(),
  sets?: OptionSets,
): Promise<void> {
  const checks: Array<[OptionProperty, string, string | null | undefined]> = [];
  if (data.lifecycleStage !== undefined && data.lifecycleStage !== null) checks.push(['lifecycle', data.lifecycleStage, existing?.lifecycle_stage]);
  if (data.leadStatus !== undefined && data.leadStatus !== null) checks.push(['leadStatus', data.leadStatus, existing?.lead_status]);
  if (data.dealType) checks.push(['dealType', data.dealType, existing?.deal_type]);
  if (!checks.length) return;
  const all = sets ?? (await listOptionSets(ws, db));
  for (const [prop, value, current] of checks) {
    if (!isAllowedOption(all[prop], value, current)) throw new CrmRefError('invalid_option');
  }
}

/** Claves de fábrica (para quien necesita saber si un valor existe en HubSpot tal cual). */
export function isBuiltinValue(prop: OptionProperty, value: string): boolean {
  return (BUILTIN_OPTIONS[prop] as readonly string[]).includes(value);
}

/** Lo mínimo de un `t` de next-intl del namespace `crm` (getTranslations o useTranslations). */
export interface CrmT {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** optionHelpers con los nombres traducidos, para páginas del servidor. */
export async function optionHelpersFor(ws: string, t: CrmT, db: Db = getDb()): Promise<OptionHelpers> {
  const sets = await listOptionSets(ws, db);
  return optionHelpers(
    sets,
    (prop, v) => (t.has(`enums.${prop}.${v}`) ? t(`enums.${prop}.${v}`) : v),
    (label) => t('propertyOptions.archivedName', { name: label }),
  );
}

/** value → nombre de las opciones propias (no de fábrica) con nombre, por propiedad: lo que el sync con HubSpot manda por nombre. */
export async function customOptionLabels(ws: string, db: Db = getDb()): Promise<{ lifecycle: Record<string, string>; leadStatus: Record<string, string> }> {
  const sets = await listOptionSets(ws, db);
  const pick = (prop: OptionProperty) =>
    Object.fromEntries(sets[prop].filter((o) => !isBuiltinValue(prop, o.value) && o.label).map((o) => [o.value, o.label as string]));
  return { lifecycle: pick('lifecycle'), leadStatus: pick('leadStatus') };
}
