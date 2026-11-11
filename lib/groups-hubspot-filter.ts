/**
 * Lines + HubSpot: el filtro de la bandeja por propiedades de la empresa,
 * resuelto en SQL contra la proyección local (groups_hubspot_values: una fila
 * por empresa y propiedad con valor).
 *
 * Por qué una tabla angosta y no json_extract sobre el JSON de la empresa: las
 * propiedades son de cada cuenta (cientos, muchas propias), así que no se
 * puede crear un índice por expresión para cada una. Con la proyección, cada
 * condición es una búsqueda por índice (workspace, propiedad, valor) que
 * devuelve las empresas que cumplen, y de ahí los chats por el índice de
 * vínculos (workspace, tipo, empresa). Los vacíos no se guardan: "está vacía"
 * es que la fila no exista.
 *
 * Todo va con el workspace como argumento: los valores de otro workspace no
 * se alcanzan. El acceso por línea y por etiqueta lo sigue poniendo
 * listChats; acá solo se agrega una condición más. Server-only.
 */
import { getDb } from './db';
import { hubspotNumeric, hubspotPropKind, hubspotTime, type HubspotPropFilter, type HubspotPropKind } from './groups-hubspot-shared';

const DAY = 86_400_000;

function likeArg(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Condición sobre una fila de groups_hubspot_values (alias zv). null si el filtro no se puede aplicar. */
function valueCond(kind: HubspotPropKind, f: HubspotPropFilter): { sql: string; args: Array<string | number> } | null {
  const value = String(f.value ?? '');
  const temporal = kind === 'date' || kind === 'datetime';
  if (f.op === 'is' || f.op === 'is_not') {
    if (temporal) {
      const day = hubspotTime(value.slice(0, 10));
      return day === null ? null : { sql: 'zv.num >= ? AND zv.num < ?', args: [day, day + DAY] };
    }
    if (kind === 'number') {
      const n = hubspotNumeric('number', value);
      return n === null ? null : { sql: 'zv.num = ?', args: [n] };
    }
    return value ? { sql: 'zv.value = ?', args: [value] } : null;
  }
  if (f.op === 'contains') return value ? { sql: "zv.value LIKE ? ESCAPE '\\'", args: [likeArg(value)] } : null;
  if (f.op === 'gt' || f.op === 'lt') {
    if (temporal) {
      // "Después de" un día es a partir del siguiente; "antes de", hasta que empieza.
      const day = hubspotTime(value.slice(0, 10));
      if (day === null) return null;
      return f.op === 'gt' ? { sql: 'zv.num >= ?', args: [day + DAY] } : { sql: 'zv.num < ?', args: [day] };
    }
    const n = hubspotNumeric('number', value);
    return n === null ? null : { sql: f.op === 'gt' ? 'zv.num > ?' : 'zv.num < ?', args: [n] };
  }
  if (f.op === 'any_of' || f.op === 'none_of') {
    const values = (f.values ?? []).filter(Boolean).slice(0, 20);
    if (values.length === 0) return null;
    if (kind === 'multi') {
      // Selección múltiple: HubSpot guarda "a;b;c".
      return {
        sql: `(${values.map(() => "(';' || zv.value || ';') LIKE ? ESCAPE '\\'").join(' OR ')})`,
        args: values.map((v) => `%;${v.replace(/[\\%_]/g, (c) => `\\${c}`)};%`),
      };
    }
    return { sql: `zv.value IN (${values.map(() => '?').join(',')})`, args: values };
  }
  return { sql: '1 = 1', args: [] };
}

/**
 * Condición para el WHERE de la lista de chats (alias c de groups_chats).
 * Solo entran chats vinculados a una empresa que sigue en HubSpot, en un
 * workspace conectado. "No es", "ninguna de" y "está vacía" incluyen a las
 * empresas sin valor. Una propiedad que no existe no devuelve nada.
 */
export async function hubspotFilterSql(ws: string, filters: HubspotPropFilter[]): Promise<{ sql: string; args: Array<string | number> } | null> {
  const list = filters.slice(0, 5);
  if (list.length === 0) return null;
  const names = [...new Set(list.map((f) => f.name))];
  const defs = (await getDb()
    .prepare(`SELECT name, type, field_type, owner_ref FROM groups_hubspot_props WHERE user_id = ? AND archived = 0 AND name IN (${names.map(() => '?').join(',')})`)
    .all(ws, ...names)) as Array<{ name: string; type: string; field_type: string; owner_ref: number }>;
  const kinds = new Map(defs.map((d) => [d.name, hubspotPropKind(d.type, d.field_type, d.owner_ref === 1)]));
  const parts: string[] = ["EXISTS (SELECT 1 FROM groups_hubspot zh WHERE zh.user_id = ? AND zh.token != '')"];
  const args: Array<string | number> = [ws];
  // Chats con una empresa vinculada que sigue en HubSpot.
  const linked = `c.id IN (SELECT zl.chat_id FROM groups_hubspot_links zl JOIN groups_hubspot_companies zc ON zc.user_id = zl.user_id AND zc.company_id = zl.object_id AND zc.missing = 0
      WHERE zl.user_id = ? AND zl.object_type = 'company')`;
  const matching = (cond: string) =>
    `(SELECT zl.chat_id FROM groups_hubspot_values zv JOIN groups_hubspot_links zl ON zl.user_id = zv.user_id AND zl.object_type = 'company' AND zl.object_id = zv.company_id
      WHERE zv.user_id = ? AND zv.name = ? AND ${cond})`;
  for (const f of list) {
    const kind = kinds.get(f.name);
    const cond = kind ? valueCond(kind, f) : null;
    if (!cond) {
      parts.push('0 = 1');
      continue;
    }
    const negative = f.op === 'is_not' || f.op === 'none_of' || f.op === 'empty';
    if (negative) {
      parts.push(`${linked} AND c.id NOT IN ${matching(cond.sql)}`);
      args.push(ws, ws, f.name, ...cond.args);
    } else {
      parts.push(`c.id IN ${matching(cond.sql)}`);
      args.push(ws, f.name, ...cond.args);
    }
  }
  return { sql: `(${parts.join(' AND ')})`, args };
}
