/**
 * Lines: los filtros de la bandeja. Un objeto serializable (LinesFilters) que
 * viaja a la API (?f=), se guarda en las listas guardadas y en la pestaña, y
 * se traduce a SQL sobre groups_chats (alias c).
 *
 * Dentro de un campo las opciones se suman (O); entre campos se cruzan (Y).
 *
 * Las listas guardadas antes de este formato ({ filter, labelIds, assignee,
 * kind, numberId, props: [{ key, op, value }] }) se leen igual: parseLinesFilters
 * las pasa al formato nuevo.
 *
 * Puro: sin base de datos ni React. El acceso (qué chats ve cada persona) no
 * pasa por acá: lo agrega listChats con chatAccessSql, igual que antes.
 */
import { cleanDateValue, cleanTextValue, resolveDateRange, type DateValue, type FilterValues, type TextValue, type Tri } from './filter-panel';
import { cleanHubspotFilters, type HubspotPropFilter } from './groups-hubspot-shared';

/** Asignado a quien mira. Así una lista compartida "Míos" le sirve a cada persona. */
export const ME = 'me';
/** Sin asignar, sin equipo, sin etiqueta. */
export const NONE = 'none';

export interface LinesPropFilter {
  key: string;
  /** is: ese valor; any: alguno de `values`; set: tiene valor; unset: no tiene. */
  op: 'is' | 'any' | 'set' | 'unset';
  value?: string;
  values?: string[];
  /** Con `is` o `any`: también los chats sin valor. */
  orEmpty?: boolean;
}

export interface LinesFilters {
  /** Búsqueda (la caja de arriba de la lista; no es un campo del panel). */
  q?: string;
  /** Sin esto: solo abiertos. */
  status?: Array<'open' | 'closed'>;
  kinds?: Array<'dm' | 'group'>;
  /** Líneas (números). */
  lines?: string[];
  /** 'me', 'none' o el id de una persona. */
  assignees?: string[];
  /** 'none' o el id de un equipo. */
  teams?: string[];
  /** 'none' o el id de una etiqueta. */
  labels?: string[];
  unread?: Tri;
  /** Esperando respuesta nuestra. */
  waiting?: Tri;
  /** Pasó el límite sin respuesta. */
  flagged?: Tri;
  pinned?: Tri;
  muted?: Tri;
  /** Tiene un ticket abierto o en curso. */
  ticket?: Tri;
  /** Tiene un agente de IA. */
  agent?: Tri;
  /** Vinculado a un contacto o empresa del CRM. */
  crm?: Tri;
  hubspot?: 'linked' | 'unlinked';
  lastMessage?: DateValue;
  /** Cuándo entró el chat a Lines. */
  created?: DateValue;
  props?: LinesPropFilter[];
  /** Condiciones sobre propiedades de la empresa de HubSpot. */
  hsProps?: HubspotPropFilter[];
}

const TRI_KEYS = ['unread', 'waiting', 'flagged', 'pinned', 'muted', 'ticket', 'agent', 'crm'] as const;
type TriKey = (typeof TRI_KEYS)[number];
const MAX_IDS = 50;
const PROP_KEY = /^[a-z0-9_]{1,40}$/;

function ids(raw: unknown, max = MAX_IDS): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100))].slice(0, max);
}

const tri = (v: unknown): Tri | undefined => (v === 'yes' || v === 'no' ? v : undefined);

function cleanProp(raw: unknown): LinesPropFilter | null {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const key = String(p.key ?? '');
  if (!PROP_KEY.test(key)) return null;
  const op = String(p.op ?? 'is');
  if (op === 'set' || op === 'unset') return { key, op };
  const values = [
    ...new Set(
      [...(Array.isArray(p.values) ? p.values : []), ...(p.value == null ? [] : [p.value])]
        .map((v) => String(v).slice(0, 200))
        .filter((v) => v !== ''),
    ),
  ].slice(0, MAX_IDS);
  if (values.length === 0) return null;
  const orEmpty = p.orEmpty === true ? { orEmpty: true } : {};
  return values.length === 1 ? { key, op: 'is', value: values[0], ...orEmpty } : { key, op: 'any', values, ...orEmpty };
}

/**
 * Filtros válidos a partir de lo que venga (el cuerpo de un pedido, el JSON de
 * una lista guardada, lo guardado en la pestaña). Acepta el formato anterior
 * y el nuevo; lo que no reconoce se descarta. El resultado es canónico: las
 * mismas condiciones dan siempre el mismo objeto, con las claves en el mismo orden.
 */
export function parseLinesFilters(raw: unknown): LinesFilters {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: LinesFilters = {};
  if (typeof r.q === 'string' && r.q.trim()) out.q = r.q.trim().slice(0, 200);

  // Formato anterior: una sola pestaña (`filter`), que hoy es un atajo de un campo.
  const tab = typeof r.filter === 'string' ? r.filter : '';
  let status = ids(r.status).filter((s): s is 'open' | 'closed' => s === 'open' || s === 'closed');
  if (status.length === 0 && tab === 'closed') status = ['closed'];
  status = (['open', 'closed'] as const).filter((s) => status.includes(s));
  // Solo abiertos es lo que hay sin filtro.
  if (status.length > 0 && !(status.length === 1 && status[0] === 'open')) out.status = status;

  let kinds = ids(r.kinds).filter((k): k is 'dm' | 'group' => k === 'dm' || k === 'group');
  if (kinds.length === 0 && (r.kind === 'dm' || r.kind === 'group')) kinds = [r.kind];
  // Los dos tipos a la vez es no filtrar.
  if (kinds.length === 1) out.kinds = kinds;

  let lines = ids(r.lines);
  if (lines.length === 0 && typeof r.numberId === 'string' && r.numberId && r.numberId.length <= 100) lines = [r.numberId];
  if (lines.length) out.lines = lines;

  let assignees = ids(r.assignees);
  if (assignees.length === 0) {
    if (tab === 'mine') assignees = [ME];
    else if (tab === 'unassigned') assignees = [NONE];
    else if (typeof r.assignee === 'string' && r.assignee && r.assignee.length <= 100) assignees = [r.assignee];
  }
  if (assignees.length) out.assignees = assignees;

  let teams = ids(r.teams);
  if (teams.length === 0 && typeof r.team === 'string' && r.team && r.team.length <= 100) teams = [r.team];
  if (teams.length) out.teams = teams;

  let labels = ids(r.labels);
  if (labels.length === 0) labels = ids(r.labelIds, 20);
  if (labels.length === 0 && typeof r.label === 'string' && r.label && r.label.length <= 100) labels = [r.label];
  if (labels.length) out.labels = labels;

  for (const k of TRI_KEYS) {
    const v = tri(r[k]);
    if (v) out[k] = v;
  }
  if (!out.unread && tab === 'unread') out.unread = 'yes';
  if (!out.waiting && tab === 'unanswered') out.waiting = 'yes';
  if (!out.flagged && tab === 'flagged') out.flagged = 'yes';

  if (r.hubspot === 'linked' || r.hubspot === 'unlinked') out.hubspot = r.hubspot;
  const lastMessage = cleanDateValue(r.lastMessage);
  if (lastMessage) out.lastMessage = lastMessage;
  const created = cleanDateValue(r.created);
  if (created) out.created = created;

  if (Array.isArray(r.props)) {
    const seen = new Set<string>();
    const props: LinesPropFilter[] = [];
    for (const p of r.props) {
      const c = cleanProp(p);
      // Una condición por propiedad (el panel tiene un campo por propiedad).
      if (!c || seen.has(c.key)) continue;
      seen.add(c.key);
      props.push(c);
      if (props.length >= 10) break;
    }
    if (props.length) out.props = props;
  }
  const hsProps = cleanHubspotFilters(r.hsProps);
  if (hsProps.length) out.hsProps = hsProps;
  return out;
}

/** JSON canónico (para comparar dos filtros y para ?f=). '' si no hay nada. */
export function serializeLinesFilters(f: LinesFilters): string {
  const clean = parseLinesFilters(f);
  return Object.keys(clean).length ? JSON.stringify(clean) : '';
}

/** El valor de ?f= (o lo guardado en la pestaña) → filtros. Algo roto es "sin filtros". */
export function linesFiltersFromParam(raw: string | null | undefined): LinesFilters {
  if (!raw) return {};
  try {
    return parseLinesFilters(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Sin la búsqueda: los filtros del panel y de las pestañas. */
export function withoutSearch(f: LinesFilters): LinesFilters {
  const { q: _q, ...rest } = f;
  return rest;
}

/** ¿No hay ningún filtro puesto? (la búsqueda no cuenta). */
export function isEmptyFilters(f: LinesFilters): boolean {
  return Object.keys(withoutSearch(parseLinesFilters(f))).length === 0;
}

/** Cuántos campos tienen algo puesto (cada propiedad es un campo; la búsqueda no cuenta). */
export function countFilters(f: LinesFilters): number {
  const c = withoutSearch(parseLinesFilters(f));
  let n = 0;
  for (const [k, v] of Object.entries(c)) n += k === 'props' ? (v as LinesPropFilter[]).length : 1;
  return n;
}

// ---------- Pestañas: atajos de un campo ----------

export const LINES_TABS = ['all', 'unread', 'groups', 'unanswered', 'mine', 'unassigned', 'flagged', 'closed'] as const;
export type LinesTab = (typeof LINES_TABS)[number];

type TabKey = Exclude<LinesTab, 'all'>;
const only = (list: string[] | undefined, v: string) => list?.length === 1 && list[0] === v;

/** Cada pestaña: cuándo está puesta, cómo se pone y cómo se saca. */
const TAB_RULES: Record<TabKey, { on: (f: LinesFilters) => boolean; set: (f: LinesFilters) => void; clear: (f: LinesFilters) => void }> = {
  unread: { on: (f) => f.unread === 'yes', set: (f) => void (f.unread = 'yes'), clear: (f) => void delete f.unread },
  groups: { on: (f) => only(f.kinds, 'group'), set: (f) => void (f.kinds = ['group']), clear: (f) => void delete f.kinds },
  unanswered: { on: (f) => f.waiting === 'yes', set: (f) => void (f.waiting = 'yes'), clear: (f) => void delete f.waiting },
  mine: { on: (f) => only(f.assignees, ME), set: (f) => void (f.assignees = [ME]), clear: (f) => void delete f.assignees },
  unassigned: { on: (f) => only(f.assignees, NONE), set: (f) => void (f.assignees = [NONE]), clear: (f) => void delete f.assignees },
  flagged: { on: (f) => f.flagged === 'yes', set: (f) => void (f.flagged = 'yes'), clear: (f) => void delete f.flagged },
  closed: { on: (f) => only(f.status, 'closed'), set: (f) => void (f.status = ['closed']), clear: (f) => void delete f.status },
};
const TAB_KEYS = Object.keys(TAB_RULES) as TabKey[];

/** Las pestañas que los filtros dejan marcadas ("Todos" si ninguna). */
export function activeTabs(f: LinesFilters): LinesTab[] {
  const on = TAB_KEYS.filter((k) => TAB_RULES[k].on(f));
  return on.length ? on : ['all'];
}

/**
 * Elegir una pestaña: saca los atajos de las otras pestañas y pone el suyo.
 * Lo demás (etiquetas, fechas, varias personas elegidas en el panel) queda.
 */
export function applyTab(f: LinesFilters, tab: LinesTab): LinesFilters {
  const next: LinesFilters = { ...f };
  for (const k of TAB_KEYS) if (TAB_RULES[k].on(next)) TAB_RULES[k].clear(next);
  if (tab !== 'all') TAB_RULES[tab].set(next);
  return parseLinesFilters(next);
}

// ---------- Panel: filtros ↔ valores por campo ----------

/** Opciones especiales de una propiedad con opciones: tiene algún valor, o ninguno. */
export const PROP_SET = '__set';
export const PROP_UNSET = '__unset';
export const propFieldId = (key: string) => `prop:${key}`;

/** Cómo se edita cada propiedad: con opciones (multi) o a mano (text). */
export type PropKinds = Record<string, 'multi' | 'text'>;

/** Los filtros como valores del panel ({ idDelCampo: valor }). */
export function filtersToValues(f: LinesFilters, propKinds: PropKinds = {}): FilterValues {
  const v: FilterValues = {};
  if (f.status?.length) v.status = [...f.status];
  if (f.kinds?.length) v.kind = [...f.kinds];
  if (f.lines?.length) v.lines = [...f.lines];
  if (f.assignees?.length) v.assignee = [...f.assignees];
  if (f.teams?.length) v.team = [...f.teams];
  if (f.labels?.length) v.labels = [...f.labels];
  for (const k of TRI_KEYS) if (f[k]) v[k] = f[k];
  if (f.hubspot) v.hubspot = f.hubspot === 'linked' ? 'yes' : 'no';
  if (f.lastMessage) v.lastMessage = f.lastMessage;
  if (f.created) v.created = f.created;
  if (f.hsProps?.length) v.hsProps = f.hsProps;
  for (const p of f.props ?? []) {
    const id = propFieldId(p.key);
    if ((propKinds[p.key] ?? 'text') === 'multi') {
      v[id] = p.op === 'set' ? [PROP_SET] : p.op === 'unset' ? [PROP_UNSET] : [...(p.orEmpty ? [PROP_UNSET] : []), ...(p.op === 'is' ? [p.value as string] : (p.values ?? []))];
    } else {
      // A mano se escribe un solo valor: de varios queda el primero.
      const text: TextValue = p.op === 'set' || p.op === 'unset' ? { mode: p.op } : { mode: 'is', value: p.op === 'is' ? (p.value as string) : (p.values?.[0] ?? '') };
      v[id] = text;
    }
  }
  return v;
}

/** Los valores del panel como filtros (la búsqueda `q` se conserva aparte). */
export function valuesToFilters(v: FilterValues, q = ''): LinesFilters {
  const arr = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
  const props: LinesPropFilter[] = [];
  for (const [id, raw] of Object.entries(v)) {
    if (!id.startsWith('prop:') || raw == null) continue;
    const key = id.slice(5);
    if (Array.isArray(raw)) {
      const picked = raw as string[];
      const values = picked.filter((x) => x !== PROP_SET && x !== PROP_UNSET);
      const set = picked.includes(PROP_SET);
      const unset = picked.includes(PROP_UNSET);
      // "Tiene valor" o "no tiene" juntos es cualquier chat: no filtra.
      if (set && unset) continue;
      if (set) props.push({ key, op: 'set' });
      else if (values.length === 0) {
        if (unset) props.push({ key, op: 'unset' });
      } else props.push({ key, op: 'any', values, ...(unset ? { orEmpty: true } : {}) });
    } else {
      const text = cleanTextValue(raw);
      if (text) props.push(text.mode === 'is' ? { key, op: 'is', value: text.value } : { key, op: text.mode });
    }
  }
  return parseLinesFilters({
    q,
    status: arr(v.status),
    kinds: arr(v.kind),
    lines: arr(v.lines),
    assignees: arr(v.assignee),
    teams: arr(v.team),
    labels: arr(v.labels),
    ...Object.fromEntries(TRI_KEYS.map((k) => [k, v[k]])),
    hubspot: v.hubspot === 'yes' ? 'linked' : v.hubspot === 'no' ? 'unlinked' : undefined,
    lastMessage: v.lastMessage,
    created: v.created,
    props,
    hsProps: v.hsProps,
  });
}

// ---------- SQL ----------

export interface LinesSqlContext {
  /** Quién mira ('me' en "asignado a"). */
  me: string;
  now?: Date;
  /** Minutos al este de UTC de quien mira (para "hoy", "esta semana"). */
  tzOffsetMin?: number;
}

type Arg = string | number;

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** "sin X" O "X es alguno de estos", sobre una columna. */
function anyOf(column: string, picked: string[], out: { where: string[]; args: Arg[] }, map: (id: string) => string = (id) => id): void {
  const none = picked.includes(NONE);
  const rest = [...new Set(picked.filter((id) => id !== NONE).map(map))];
  const parts: string[] = [];
  if (none) parts.push(`${column} IS NULL`);
  if (rest.length) {
    parts.push(`${column} IN (${marks(rest.length)})`);
    out.args.push(...rest);
  }
  if (parts.length) out.where.push(parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);
}

function triSql(v: Tri | undefined, yes: string, no: string, out: { where: string[] }): void {
  if (v === 'yes') out.where.push(yes);
  else if (v === 'no') out.where.push(no);
}

/**
 * Las condiciones SQL de los filtros sobre groups_chats (alias c), con sus
 * args en orden. No incluye la búsqueda, HubSpot (necesitan la base) ni el
 * acceso de quien mira: eso lo agrega listChats.
 *
 * `status` siempre viene: sin filtro de estado son solo los abiertos (el
 * índice de la lista empieza por workspace y estado).
 */
export function linesFiltersSql(raw: LinesFilters, ctx: LinesSqlContext): { where: string[]; args: Arg[] } {
  const f = parseLinesFilters(raw);
  const out: { where: string[]; args: Arg[] } = { where: [], args: [] };
  const now = ctx.now ?? new Date();

  const status = f.status ?? ['open'];
  // Abiertos y cerrados a la vez: sin condición de estado.
  if (status.length === 1) out.where.push(`c.status = '${status[0] === 'closed' ? 'closed' : 'open'}'`);

  if (f.kinds?.length === 1) {
    out.where.push('c.kind = ?');
    out.args.push(f.kinds[0]);
  }
  if (f.lines?.length) {
    out.where.push(`c.number_id IN (${marks(f.lines.length)})`);
    out.args.push(...f.lines);
  }
  if (f.assignees?.length) anyOf('c.assigned_to', f.assignees, out, (id) => (id === ME ? ctx.me : id));
  if (f.teams?.length) anyOf('c.assigned_team_id', f.teams, out);
  if (f.labels?.length) {
    const none = f.labels.includes(NONE);
    const rest = f.labels.filter((id) => id !== NONE);
    const parts: string[] = [];
    if (none) parts.push('NOT EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id)');
    if (rest.length) {
      parts.push(`EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id IN (${marks(rest.length)}))`);
      out.args.push(...rest);
    }
    out.where.push(parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);
  }
  triSql(f.unread, 'c.unread_count > 0', 'c.unread_count = 0', out);
  triSql(f.waiting, 'c.awaiting_since IS NOT NULL', 'c.awaiting_since IS NULL', out);
  triSql(f.flagged, 'c.flagged_at IS NOT NULL', 'c.flagged_at IS NULL', out);
  triSql(f.pinned, 'c.pinned_at IS NOT NULL', 'c.pinned_at IS NULL', out);
  if (f.muted) {
    out.where.push(f.muted === 'yes' ? '(c.muted_until IS NOT NULL AND c.muted_until > ?)' : '(c.muted_until IS NULL OR c.muted_until <= ?)');
    out.args.push(now.toISOString());
  }
  const openTicket = "EXISTS (SELECT 1 FROM groups_tickets gt WHERE gt.chat_id = c.id AND gt.status IN ('open', 'in_progress'))";
  triSql(f.ticket, openTicket, `NOT ${openTicket}`, out);
  triSql(f.agent, 'c.agent_id IS NOT NULL', 'c.agent_id IS NULL', out);
  triSql(f.crm, '(c.crm_contact_id IS NOT NULL OR c.crm_company_id IS NOT NULL)', '(c.crm_contact_id IS NULL AND c.crm_company_id IS NULL)', out);

  if (f.lastMessage) {
    const r = resolveDateRange(f.lastMessage, now, ctx.tzOffsetMin);
    // La misma expresión que ordena la lista (idx_groups_chats_list): el rango se resuelve en el índice.
    // Un chat sin mensajes no tiene "último mensaje".
    const key = 'COALESCE(c.last_message_at, c.created_at)';
    out.where.push('c.last_message_at IS NOT NULL');
    if (r.from) {
      out.where.push(`${key} >= ?`);
      out.args.push(r.from);
    }
    if (r.to) {
      out.where.push(`${key} < ?`);
      out.args.push(r.to);
    }
  }
  if (f.created) {
    const r = resolveDateRange(f.created, now, ctx.tzOffsetMin);
    if (r.from) {
      out.where.push('c.created_at >= ?');
      out.args.push(r.from);
    }
    if (r.to) {
      out.where.push('c.created_at < ?');
      out.args.push(r.to);
    }
  }
  for (const p of f.props ?? []) {
    const path = `$."${p.key}"`;
    if (p.op === 'set') {
      out.where.push('json_extract(c.properties, ?) IS NOT NULL');
      out.args.push(path);
    } else if (p.op === 'unset') {
      out.where.push('json_extract(c.properties, ?) IS NULL');
      out.args.push(path);
    } else {
      const values = p.op === 'is' ? [p.value as string] : (p.values ?? []);
      if (values.length === 0) continue;
      // json_each sobre un valor suelto devuelve ese valor: sirve para texto, número, multiselección y dependiente.
      const has = `EXISTS (SELECT 1 FROM json_each(c.properties, ?) je WHERE CAST(je.value AS TEXT) IN (${marks(values.length)}))`;
      if (p.orEmpty) {
        out.where.push(`(json_extract(c.properties, ?) IS NULL OR ${has})`);
        out.args.push(path, path, ...values);
      } else {
        out.where.push(has);
        out.args.push(path, ...values);
      }
    }
  }
  return out;
}
