/**
 * Operaciones sobre una base guardada en otra página (o en otro bloque de
 * la misma): vistas vinculadas, relaciones de dos vías, la acción "agregar
 * fila en otra base" de botones y automatizaciones. En vez de mandar la base
 * entera (y pisar lo que otro editó), el cliente manda operaciones chicas y
 * el servidor las aplica sobre la versión guardada.
 *
 * También el motor de automatizaciones (puro): qué automatizaciones dispara
 * un cambio y qué hacen las acciones que cambian la propia base. Lo corren el
 * editor (para ver el cambio al instante) y el servidor al guardar (para las
 * acciones de afuera: notificar, webhook, agregar fila en otra base).
 */
import type { DbAction, DbAutomation, DbFile, DbProperty, DbRow, DbValue, DocsBlock, DocsDatabase } from './docs-types';
import {
  DB_MAX_ROWS,
  addRow,
  deleteRows,
  findRow,
  isComputedType,
  isEmptyValue,
  matchesFilter,
  moveRow,
  removeProperty,
  setCell,
  titleProperty,
  updateRow,
} from './docs-database';

export type DbOp =
  | { op: 'set_cell'; row: string; prop: string; value: DbValue }
  | { op: 'relation'; row: string; prop: string; add?: string[]; remove?: string[] }
  | { op: 'add_row'; id?: string; values?: Record<string, DbValue>; title?: string; body?: DocsBlock[]; files?: Record<string, DbFile[]>; before?: string | null }
  | { op: 'delete_rows'; rows: string[] }
  | { op: 'set_body'; row: string; body: DocsBlock[] }
  | { op: 'set_files'; row: string; prop: string; files: DbFile[] }
  | { op: 'move_row'; row: string; before: string | null }
  | { op: 'add_property'; property: DbProperty }
  | { op: 'update_property'; property: DbProperty }
  | { op: 'remove_property'; prop: string }
  | { op: 'set_title'; title: string }
  | { op: 'set_automations'; automations: DbAutomation[] };

export const DB_MAX_OPS = 500;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Aplica operaciones en orden. Las que nombran filas o propiedades que no existen se saltean. */
export function applyDbOps(db: DocsDatabase, ops: DbOp[], now = new Date().toISOString()): DocsDatabase {
  let cur = db;
  for (const o of ops.slice(0, DB_MAX_OPS)) {
    switch (o.op) {
      case 'set_cell':
        cur = setCell(cur, o.row, o.prop, o.value, now);
        break;
      case 'relation': {
        const row = findRow(cur, o.row);
        const prop = cur.properties.find((p) => p.id === o.prop && p.type === 'relation');
        if (!row || !prop || prop.relation?.mirror_of) break;
        const have = Array.isArray(row.values[prop.id]) ? (row.values[prop.id] as string[]) : [];
        let next = have.filter((id) => !(o.remove ?? []).includes(id));
        for (const id of o.add ?? []) if (!next.includes(id)) next.push(id);
        if (prop.relation?.limit === 1) next = next.slice(-1);
        if (!same(next, have)) cur = setCell(cur, row.id, prop.id, next.slice(0, 100), now);
        break;
      }
      case 'add_row': {
        if (cur.rows.length >= DB_MAX_ROWS) break;
        if (o.id && findRow(cur, o.id)) break;
        const values: Record<string, DbValue> = {};
        const props = new Map(cur.properties.map((p) => [p.id, p]));
        for (const [k, v] of Object.entries(o.values ?? {})) {
          const p = props.get(k);
          if (p && !isComputedType(p.type) && !p.relation?.mirror_of && !isEmptyValue(v)) values[k] = v;
        }
        if (o.title !== undefined) {
          const tp = titleProperty(cur);
          if (tp && o.title) values[tp.id] = o.title;
        }
        const res = addRow(cur, values, now);
        let row = res.row;
        let next = res.db;
        if (o.id) {
          next = { ...next, rows: next.rows.map((r) => (r.id === row.id ? { ...r, id: o.id! } : r)) };
          row = { ...row, id: o.id };
        }
        if (o.body?.length || o.files) {
          next = {
            ...next,
            rows: next.rows.map((r) => (r.id === row.id ? { ...r, ...(o.body?.length ? { body: o.body } : {}), ...(o.files ? { files: o.files } : {}) } : r)),
          };
        }
        if (o.before !== undefined) next = moveRow(next, row.id, o.before);
        cur = next;
        break;
      }
      case 'delete_rows':
        cur = deleteRows(cur, o.rows);
        break;
      case 'set_body':
        if (findRow(cur, o.row)) cur = updateRow(cur, o.row, { body: o.body }, now);
        break;
      case 'set_files': {
        const row = findRow(cur, o.row);
        if (!row || !cur.properties.some((p) => p.id === o.prop && p.type === 'files')) break;
        const files = { ...(row.files ?? {}) };
        if (o.files.length) files[o.prop] = o.files;
        else delete files[o.prop];
        cur = {
          ...cur,
          rows: cur.rows.map((r) => {
            if (r.id !== o.row) return r;
            const out: DbRow = { ...r, updated_at: now };
            if (Object.keys(files).length) out.files = files;
            else delete out.files;
            return out;
          }),
        };
        break;
      }
      case 'move_row':
        cur = moveRow(cur, o.row, o.before);
        break;
      case 'add_property':
        if (o.property.type === 'title' || cur.properties.some((p) => p.id === o.property.id) || cur.properties.length >= 40) break;
        cur = { ...cur, properties: [...cur.properties, stripTransient(o.property)] };
        break;
      case 'update_property': {
        const old = cur.properties.find((p) => p.id === o.property.id);
        if (!old) break;
        // El tipo del título no cambia; el resto viene entero.
        const next = stripTransient({ ...o.property, type: old.type === 'title' ? 'title' : o.property.type });
        cur = { ...cur, properties: cur.properties.map((p) => (p.id === old.id ? next : p)) };
        break;
      }
      case 'remove_property':
        cur = removeProperty(cur, o.prop);
        break;
      case 'set_title':
        cur = { ...cur, title: o.title };
        break;
      case 'set_automations':
        cur = { ...cur, automations: o.automations };
        break;
    }
  }
  return cur;
}

function stripTransient(p: DbProperty): DbProperty {
  const { kind: _kind, error: _error, ...rest } = p;
  void _kind;
  void _error;
  return rest;
}

/**
 * Operaciones que llevan de `prev` a `next` (sin vistas: en una vista
 * vinculada las vistas son del bloque). Lo usa la vista vinculada para
 * mandar al servidor solo lo que cambió.
 */
export function diffDatabase(prev: DocsDatabase, next: DocsDatabase): DbOp[] {
  const ops: DbOp[] = [];
  if ((prev.title ?? '') !== (next.title ?? '')) ops.push({ op: 'set_title', title: next.title ?? '' });
  const prevProps = new Map(prev.properties.map((p) => [p.id, p]));
  const nextProps = new Map(next.properties.map((p) => [p.id, p]));
  for (const p of next.properties) {
    const old = prevProps.get(p.id);
    if (!old) ops.push({ op: 'add_property', property: stripTransient(p) });
    else if (!same(stripTransient(old), stripTransient(p))) ops.push({ op: 'update_property', property: stripTransient(p) });
  }
  for (const p of prev.properties) if (!nextProps.has(p.id)) ops.push({ op: 'remove_property', prop: p.id });
  if (!same(prev.automations, next.automations)) ops.push({ op: 'set_automations', automations: next.automations ?? [] });

  const prevRows = new Map(prev.rows.map((r) => [r.id, r]));
  const nextIds = new Set(next.rows.map((r) => r.id));
  const removed = prev.rows.filter((r) => !nextIds.has(r.id)).map((r) => r.id);
  if (removed.length) ops.push({ op: 'delete_rows', rows: removed });
  next.rows.forEach((r, i) => {
    const old = prevRows.get(r.id);
    if (!old) {
      const before = next.rows[i + 1]?.id ?? null;
      ops.push({ op: 'add_row', id: r.id, values: r.values, ...(r.body?.length ? { body: r.body } : {}), ...(r.files ? { files: r.files } : {}), before });
      return;
    }
    const keys = new Set([...Object.keys(old.values), ...Object.keys(r.values)]);
    for (const k of keys) {
      if (!same(old.values[k], r.values[k])) ops.push({ op: 'set_cell', row: r.id, prop: k, value: r.values[k] ?? null });
    }
    if (!same(old.body, r.body)) ops.push({ op: 'set_body', row: r.id, body: r.body ?? [] });
    const fileKeys = new Set([...Object.keys(old.files ?? {}), ...Object.keys(r.files ?? {})]);
    for (const k of fileKeys) if (!same(old.files?.[k], r.files?.[k])) ops.push({ op: 'set_files', row: r.id, prop: k, files: r.files?.[k] ?? [] });
  });
  // Orden manual (arrastrar en un board sin orden): se manda la fila movida.
  const prevOrder = prev.rows.map((r) => r.id).filter((id) => nextIds.has(id));
  const nextOrder = next.rows.map((r) => r.id).filter((id) => prevRows.has(id));
  if (!same(prevOrder, nextOrder)) {
    for (let i = 0; i < nextOrder.length; i++) {
      if (nextOrder[i] !== prevOrder[i]) {
        const id = nextOrder[i];
        const before = nextOrder[i + 1] ?? null;
        ops.push({ op: 'move_row', row: id, before });
        break;
      }
    }
  }
  return ops;
}

// ---------- Automatizaciones ----------

export const DB_MAX_AUTOMATIONS = 20;
export const DB_MAX_ACTIONS = 10;

/** Acciones que cambian la propia base (las corre quien edita, al instante). */
export const isLocalAction = (a: DbAction) => a.type === 'set_prop';

/** El valor nuevo cumple "cambia a …" del disparador. */
function matchesTo(prop: DbProperty | undefined, value: DbValue, to: DbValue | undefined): boolean {
  if (to === undefined || to === null || (Array.isArray(to) && to.length === 0) || to === '') return true;
  if (!prop) return false;
  if (prop.type === 'checkbox') return (value === true) === (to === true);
  if (Array.isArray(value)) return (Array.isArray(to) ? to : [to]).every((x) => (value as string[]).includes(String(x)));
  if (typeof value === 'number' && typeof to === 'number') return value === to;
  return String(value ?? '').trim().toLowerCase() === String(to).trim().toLowerCase();
}

/** Valor de una acción "editar propiedad": poner, agregar o sacar (multi, persona, relación). */
export function actionValue(prop: DbProperty, current: DbValue, action: Extract<DbAction, { type: 'set_prop' }>, now = new Date()): DbValue {
  let value = action.value;
  // Fecha "hoy" (como la opción "Now" de Notion).
  if (prop.type === 'date' && value === '@today') {
    const p = (n: number) => String(n).padStart(2, '0');
    value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }
  const isList = prop.type === 'multi_select' || prop.type === 'person' || prop.type === 'relation';
  if (!isList || !action.mode || action.mode === 'set') return value;
  const have = Array.isArray(current) ? current : [];
  const ids = Array.isArray(value) ? value : value === null || value === undefined ? [] : [String(value)];
  if (action.mode === 'add') return [...new Set([...have, ...ids])];
  return have.filter((x) => !ids.includes(x));
}

export interface FiredAutomation {
  automation: DbAutomation;
  rowId: string;
}

/**
 * Corre las automatizaciones de `next` contra lo que cambió desde `prev`:
 * filas nuevas y propiedades que cambiaron (con "cambia a" opcional), solo
 * las filas que cumplen los filtros de la vista elegida. Aplica las
 * acciones "editar propiedad" y devuelve cuáles se dispararon (el servidor
 * corre las acciones de afuera). Cada automatización corre una vez por fila
 * y por cambio; lo que cambian las acciones puede disparar otra (hasta tres
 * pasadas), igual en el editor y en el servidor, así los dos llegan al mismo
 * resultado.
 */
export function runAutomations(
  prev: DocsDatabase | null,
  next: DocsDatabase,
  opts: { now?: string } = {},
): { db: DocsDatabase; fired: FiredAutomation[] } {
  const autos = (next.automations ?? []).filter((a) => a.enabled && a.actions.length);
  if (!prev || autos.length === 0) return { db: next, fired: [] };
  const now = opts.now ?? new Date().toISOString();
  const fired: FiredAutomation[] = [];
  const done = new Set<string>();
  let before = prev;
  let cur = next;
  for (let pass = 0; pass < 3; pass++) {
    const prevRows = new Map(before.rows.map((r) => [r.id, r]));
    const hits: FiredAutomation[] = [];
    for (const row of cur.rows) {
      const old = prevRows.get(row.id);
      for (const a of autos) {
        const k = `${a.id}:${row.id}`;
        if (done.has(k)) continue;
        let trig = false;
        const isNew = !prev.rows.some((r) => r.id === row.id);
        if (a.trigger.type === 'row_added') trig = !old && isNew;
        else {
          const pid = a.trigger.prop;
          const p = cur.properties.find((x) => x.id === pid);
          // Fila nueva que ya trae la propiedad puesta: cuenta como cambio (así el editor, que la
          // pone en dos pasos, y el servidor, que la ve de una, disparan lo mismo).
          const before = old ? old.values[pid] : undefined;
          const changed = old ? !same(before, row.values[pid]) : isNew && !isEmptyValue(row.values[pid] ?? null) && row.values[pid] !== false;
          trig = Boolean(p) && changed && matchesTo(p, row.values[pid] ?? null, a.trigger.to);
        }
        if (!trig) continue;
        if (a.view) {
          const view = cur.views.find((v) => v.id === a.view);
          if (view && !(view.filters ?? []).every((f) => matchesFilter(cur, row, f))) continue;
        }
        done.add(k);
        hits.push({ automation: a, rowId: row.id });
      }
    }
    if (!hits.length) break;
    const start = cur;
    for (const h of hits) {
      for (const act of h.automation.actions) {
        if (act.type !== 'set_prop') continue;
        const prop = cur.properties.find((p) => p.id === act.prop);
        const row = findRow(cur, h.rowId);
        if (!prop || !row || isComputedType(prop.type) || prop.relation?.mirror_of) continue;
        const value = actionValue(prop, row.values[prop.id] ?? null, act, new Date(now));
        if (!same(row.values[prop.id], value)) cur = setCell(cur, row.id, prop.id, value, now);
      }
    }
    fired.push(...hits);
    before = start;
    if (cur === start) break;
  }
  return { db: cur, fired };
}

/** Acciones de un botón (o automatización) que no tocan la propia base. */
export function remoteActions(actions: DbAction[]): DbAction[] {
  return actions.filter((a) => a.type !== 'set_prop' && a.type !== 'open_url');
}

/** Aplica las acciones "editar propiedad" de un botón sobre una fila. */
export function applyButtonActions(db: DocsDatabase, rowId: string, actions: DbAction[], now = new Date().toISOString()): DocsDatabase {
  let cur = db;
  for (const act of actions) {
    if (act.type !== 'set_prop') continue;
    const prop = cur.properties.find((p) => p.id === act.prop);
    const row = findRow(cur, rowId);
    if (!prop || !row || isComputedType(prop.type) || prop.relation?.mirror_of) continue;
    cur = setCell(cur, rowId, prop.id, actionValue(prop, row.values[prop.id] ?? null, act, new Date(now)), now);
  }
  return cur;
}

/**
 * Texto con variables de la fila: {{title}} (o {{Name}} de cualquier
 * propiedad, por nombre). Lo usan el mensaje de "notificar" y el título de
 * "agregar fila".
 */
export function fillTemplate(text: string, db: DocsDatabase, row: DbRow | undefined, format: (p: DbProperty, r: DbRow) => string): string {
  if (!row || !text.includes('{{')) return text;
  return text.replace(/\{\{\s*([^{}]{1,100}?)\s*\}\}/g, (_m, name: string) => {
    const key = name.trim();
    const prop = key.toLowerCase() === 'title' ? titleProperty(db) : db.properties.find((p) => p.name === key);
    return prop ? format(prop, row) : '';
  });
}
