/**
 * Lines: la vista kanban de la bandeja. Los chats de la bandeja (con los
 * mismos filtros, búsqueda, carpeta, línea y archivados) repartidos en
 * columnas. Tres fuentes de columnas:
 *
 * - Etapas del equipo (owner_id ''): las define un admin; las ve todo el
 *   workspace. En qué etapa está un chat es uno por chat y lo ve el equipo.
 *   Mover un chat pide lo mismo que editar sus propiedades: poder verlo.
 * - Mis etapas (owner_id = la persona): su tablero personal. Nadie más ve esas
 *   etapas ni dónde puso cada chat, tampoco un admin. El id de una etapa de
 *   otra persona se comporta como uno que no existe (404) en todas las rutas.
 * - Una propiedad de selección de la empresa de HubSpot vinculada al chat:
 *   sus opciones son las columnas; sin empresa o sin valor, "Sin valor".
 *   Mover escribe en HubSpot por el camino de siempre
 *   (updateHubspotCompanyProperty): sin permiso de escritura de la clave, para
 *   un invitado o con teléfonos ocultos, el tablero es de solo lectura.
 *
 * Siempre solo chats que quien mira puede ver (listChats con su viewer): los
 * conteos por columna también. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError, listChats, type ChatDto, type ChatQuery } from './groups';
import { canSeeChat, type GroupsViewer } from './groups-access';
import { roleAtLeast } from './teams';
import {
  KANBAN_CARDS_PER_COLUMN,
  KANBAN_HS_PREFIX,
  KANBAN_MAX_CHATS,
  KANBAN_MAX_STAGES,
  KANBAN_NONE,
  KANBAN_TEAM,
  boardSource,
  cleanStageColor,
  type KanbanBoardDto,
  type KanbanColumnDto,
  type KanbanHubspotProp,
  type KanbanReadOnly,
  type KanbanStageDto,
} from './groups-kanban-shared';

const nowIso = () => new Date().toISOString();
const TEAM_OWNER = '';
const VIEW_KEY = 'kanban';
const BOARD_KEY = 'kanban_board';
const collapsedKey = (board: string) => `kanban_collapsed:${board}`.slice(0, 200);

/** El tablero de etapas: '' para las del equipo, el id de la persona para las suyas. */
export type StageScope = 'team' | 'me';
const ownerOf = (viewer: GroupsViewer, scope: StageScope) => (scope === 'team' ? TEAM_OWNER : viewer.me);
export const isLinesAdmin = (viewer: GroupsViewer) => roleAtLeast(viewer.role, 'admin');

// ======================================================================
// Preferencias de cada persona
// ======================================================================

async function getPref(viewer: GroupsViewer, key: string): Promise<string | null> {
  const r = (await getDb().prepare('SELECT value FROM groups_user_prefs WHERE user_id = ? AND person_id = ? AND key = ?').get(viewer.ws, viewer.me, key)) as
    | { value: string }
    | undefined;
  return r?.value ?? null;
}

async function setPref(viewer: GroupsViewer, key: string, value: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO groups_user_prefs (user_id, person_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, person_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(viewer.ws, viewer.me, key, value, nowIso());
}

export interface KanbanPrefs {
  /** La bandeja se ve como kanban. */
  on: boolean;
  /** El último tablero elegido. */
  board: string;
}

export async function getKanbanPrefs(viewer: GroupsViewer): Promise<KanbanPrefs> {
  const [on, board] = await Promise.all([getPref(viewer, VIEW_KEY), getPref(viewer, BOARD_KEY)]);
  return { on: on === '1', board: board && boardSource(board) ? board : KANBAN_TEAM };
}

/** Guarda lo que venga: la vista, el tablero o las columnas plegadas de un tablero. */
export async function setKanbanPrefs(viewer: GroupsViewer, input: { on?: boolean; board?: string; collapsed?: { board: string; columns: string[] } }): Promise<KanbanPrefs> {
  if (input.on !== undefined) await setPref(viewer, VIEW_KEY, input.on ? '1' : '0');
  if (input.board !== undefined) {
    if (!boardSource(input.board)) throw new GroupsError('invalid_input');
    await setPref(viewer, BOARD_KEY, input.board);
  }
  if (input.collapsed) {
    if (!boardSource(input.collapsed.board)) throw new GroupsError('invalid_input');
    const cols = [...new Set(input.collapsed.columns.map((c) => String(c).slice(0, 200)))].slice(0, 100);
    await setPref(viewer, collapsedKey(input.collapsed.board), JSON.stringify(cols));
  }
  return getKanbanPrefs(viewer);
}

async function collapsedOf(viewer: GroupsViewer, board: string): Promise<string[]> {
  try {
    const v = JSON.parse((await getPref(viewer, collapsedKey(board))) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ======================================================================
// Etapas (del equipo y de cada persona)
// ======================================================================

interface StageRow {
  id: string;
  name: string;
  color: string;
  position: number;
}

const toStage = (r: StageRow): KanbanStageDto => ({ id: r.id, name: r.name, color: cleanStageColor(r.color), position: Number(r.position) });

export async function listStages(viewer: GroupsViewer, scope: StageScope): Promise<KanbanStageDto[]> {
  const rows = (await getDb()
    .prepare('SELECT id, name, color, position FROM groups_kanban_stages WHERE user_id = ? AND owner_id = ? ORDER BY position, created_at, id')
    .all(viewer.ws, ownerOf(viewer, scope))) as StageRow[];
  return rows.map(toStage);
}

/** La etapa si es de este tablero (del equipo, o de quien mira); si es de otra persona u otro workspace, null. */
async function stageRow(viewer: GroupsViewer, scope: StageScope, id: string): Promise<StageRow | null> {
  return (
    ((await getDb()
      .prepare('SELECT id, name, color, position FROM groups_kanban_stages WHERE id = ? AND user_id = ? AND owner_id = ?')
      .get(String(id).slice(0, 100), viewer.ws, ownerOf(viewer, scope))) as StageRow | undefined) ?? null
  );
}

/** Las etapas del equipo las edita un admin; las propias, cada persona. */
function assertCanEdit(viewer: GroupsViewer, scope: StageScope): void {
  if (scope === 'team' && !isLinesAdmin(viewer)) throw new GroupsError('forbidden', 403);
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!name) throw new GroupsError('invalid_input');
  return name;
}

export async function createStage(viewer: GroupsViewer, scope: StageScope, input: { name: unknown; color?: unknown }): Promise<KanbanStageDto> {
  assertCanEdit(viewer, scope);
  const name = cleanName(input.name);
  const db = getDb();
  const owner = ownerOf(viewer, scope);
  const n = (await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM groups_kanban_stages WHERE user_id = ? AND owner_id = ?').get(viewer.ws, owner)) as {
    n: number;
    last: number;
  };
  if (Number(n.n) >= KANBAN_MAX_STAGES) throw new GroupsError('too_many_stages', 409);
  const id = randomUUID();
  const at = nowIso();
  await db
    .prepare('INSERT INTO groups_kanban_stages (id, user_id, owner_id, name, color, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, viewer.ws, owner, name, cleanStageColor(input.color), Number(n.last) + 1, viewer.me, at, at);
  return { id, name, color: cleanStageColor(input.color), position: Number(n.last) + 1 };
}

/** Renombra o cambia el color. Una etapa de otra persona (o de otro workspace) es 404. */
export async function updateStage(viewer: GroupsViewer, scope: StageScope, id: string, input: { name?: unknown; color?: unknown }): Promise<KanbanStageDto> {
  assertCanEdit(viewer, scope);
  const row = await stageRow(viewer, scope, id);
  if (!row) throw new GroupsError('not_found', 404);
  const name = input.name !== undefined ? cleanName(input.name) : row.name;
  const color = input.color !== undefined ? cleanStageColor(input.color) : cleanStageColor(row.color);
  await getDb().prepare('UPDATE groups_kanban_stages SET name = ?, color = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(name, color, nowIso(), row.id, viewer.ws);
  return { id: row.id, name, color, position: Number(row.position) };
}

/** Nuevo orden: las etapas nombradas van en ese orden; las que falten quedan al final como estaban. Ids ajenos se ignoran. */
export async function reorderStages(viewer: GroupsViewer, scope: StageScope, ids: string[]): Promise<KanbanStageDto[]> {
  assertCanEdit(viewer, scope);
  const current = await listStages(viewer, scope);
  const known = new Set(current.map((s) => s.id));
  const wanted = [...new Set(ids)].filter((id) => known.has(id));
  const order = [...wanted, ...current.map((s) => s.id).filter((id) => !wanted.includes(id))];
  const db = getDb();
  for (const [i, id] of order.entries()) {
    await db.prepare('UPDATE groups_kanban_stages SET position = ?, updated_at = ? WHERE id = ? AND user_id = ? AND owner_id = ?').run(i, nowIso(), id, viewer.ws, ownerOf(viewer, scope));
  }
  return listStages(viewer, scope);
}

/** Borra la etapa; sus chats vuelven a "Sin etapa". false si no existe para quien pide. */
export async function deleteStage(viewer: GroupsViewer, scope: StageScope, id: string): Promise<boolean> {
  assertCanEdit(viewer, scope);
  const row = await stageRow(viewer, scope, id);
  if (!row) return false;
  const db = getDb();
  await db.prepare('DELETE FROM groups_kanban_cards WHERE stage_id = ? AND user_id = ?').run(row.id, viewer.ws);
  await db.prepare('DELETE FROM groups_kanban_stages WHERE id = ? AND user_id = ?').run(row.id, viewer.ws);
  return true;
}

/** En qué etapa de este tablero está cada chat (los que no figuran, en ninguna). */
async function stagesOfChats(viewer: GroupsViewer, scope: StageScope, chatIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = getDb();
  for (let i = 0; i < chatIds.length; i += 400) {
    const chunk = chatIds.slice(i, i + 400);
    const rows = (await db
      .prepare(`SELECT chat_id, stage_id FROM groups_kanban_cards WHERE user_id = ? AND owner_id = ? AND chat_id IN (${chunk.map(() => '?').join(',')})`)
      .all(viewer.ws, ownerOf(viewer, scope), ...chunk)) as Array<{ chat_id: string; stage_id: string }>;
    for (const r of rows) out.set(r.chat_id, r.stage_id);
  }
  return out;
}

// ======================================================================
// HubSpot
// ======================================================================

interface HubspotBoardInfo {
  connected: boolean;
  /** Propiedades de selección (una opción) de la empresa, visibles. */
  props: Array<KanbanHubspotProp & { options: Array<{ label: string; value: string }>; readOnly: boolean }>;
  canWrite: boolean;
}

async function hubspotInfo(ws: string): Promise<HubspotBoardInfo> {
  const { getHubspotSchema } = await import('./groups-hubspot-sync');
  const schema = await getHubspotSchema(ws).catch(() => null);
  if (!schema?.connected) return { connected: false, props: [], canWrite: false };
  const props = schema.props
    .filter((p) => p.kind === 'select' && p.options.length > 0 && !p.hidden)
    .map((p) => ({ name: p.name, label: p.label || p.name, options: p.options, readOnly: p.readOnly || p.calculated }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { connected: true, props, canWrite: schema.canWrite };
}

/** Por qué esta persona no puede mover en el tablero de esa propiedad (null: puede). Las mismas reglas que editar la propiedad en el chat. */
function hubspotReadOnly(viewer: GroupsViewer, info: HubspotBoardInfo, prop: HubspotBoardInfo['props'][number]): KanbanReadOnly {
  if (prop.readOnly) return 'hubspot_read_only';
  if (!info.canWrite) return 'hubspot_scope';
  if (viewer.role === 'guest' || viewer.mask) return 'hubspot_role';
  return null;
}

/** El valor de la propiedad en la empresa vinculada a cada chat. Sin empresa vinculada (o borrada): no figura en `linked`. */
async function hubspotValues(ws: string, prop: string, chatIds: string[]): Promise<{ values: Map<string, string>; linked: Set<string> }> {
  const values = new Map<string, string>();
  const linked = new Set<string>();
  const db = getDb();
  const path = `$."${prop.replace(/"/g, '')}"`;
  for (let i = 0; i < chatIds.length; i += 400) {
    const chunk = chatIds.slice(i, i + 400);
    const rows = (await db
      .prepare(
        `SELECT l.chat_id, json_extract(co.props, ?) AS v, COALESCE(co.missing, 0) AS missing FROM groups_hubspot_links l
         LEFT JOIN groups_hubspot_companies co ON co.user_id = l.user_id AND co.company_id = l.object_id
         WHERE l.user_id = ? AND l.object_type = 'company' AND l.chat_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(path, ws, ...chunk)) as Array<{ chat_id: string; v: unknown; missing: number }>;
    for (const r of rows) {
      if (Number(r.missing) === 1) continue;
      linked.add(r.chat_id);
      if (r.v !== null && r.v !== undefined && String(r.v) !== '') values.set(r.chat_id, String(r.v));
    }
  }
  return { values, linked };
}

// ======================================================================
// El tablero
// ======================================================================

/**
 * El tablero pedido (o el último que eligió la persona) con los chats de la
 * bandeja que ve con estos filtros. Un tablero que ya no existe (HubSpot
 * desconectado, propiedad borrada) cae en el de etapas del equipo.
 */
export async function kanbanBoard(viewer: GroupsViewer, board: string | null, query: ChatQuery): Promise<KanbanBoardDto<ChatDto>> {
  const wanted = board ?? (await getKanbanPrefs(viewer)).board;
  const info = await hubspotInfo(viewer.ws);
  let parsed = boardSource(wanted) ?? { source: 'team' as const, prop: '' };
  const hsProp = parsed.source === 'hs' ? info.props.find((p) => p.name === parsed.prop) : undefined;
  if (parsed.source === 'hs' && !hsProp) parsed = { source: 'team', prop: '' };
  const key = parsed.source === 'hs' ? `${KANBAN_HS_PREFIX}${parsed.prop}` : parsed.source;

  const res = await listChats(viewer.ws, viewer.me, { ...query, viewer, cursor: '', count: false, limit: KANBAN_MAX_CHATS });
  // Al buscar, un chat puede venir dos veces (por el nombre y por un mensaje): una tarjeta por chat.
  const seen = new Set<string>();
  const chats = res.rows.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const ids = chats.map((c) => c.id);

  let columns: Array<KanbanColumnDto<ChatDto>>;
  let place: (c: ChatDto) => string;
  let readOnly: KanbanReadOnly = null;
  let unlinked: string[] | undefined;
  const none = (name: string): KanbanColumnDto<ChatDto> => ({ id: KANBAN_NONE, name, color: 'gray', count: 0, cards: [] });
  if (parsed.source === 'hs' && hsProp) {
    const { values, linked } = await hubspotValues(viewer.ws, hsProp.name, ids);
    columns = [none(''), ...hsProp.options.map((o) => ({ id: o.value, name: o.label || o.value, color: 'gray' as const, count: 0, cards: [] }))];
    // Un valor que la propiedad ya no ofrece: su propia columna, para no esconder esos chats.
    for (const v of new Set(values.values())) if (!columns.some((c) => c.id === v)) columns.push({ id: v, name: v, color: 'gray', count: 0, cards: [], stale: true });
    place = (c) => values.get(c.id) ?? KANBAN_NONE;
    readOnly = hubspotReadOnly(viewer, info, hsProp);
    unlinked = ids.filter((id) => !linked.has(id));
  } else {
    const scope = parsed.source as StageScope;
    const [stages, at] = await Promise.all([listStages(viewer, scope), stagesOfChats(viewer, scope, ids)]);
    columns = [none(''), ...stages.map((s) => ({ id: s.id, name: s.name, color: s.color, count: 0, cards: [] }))];
    const known = new Set(stages.map((s) => s.id));
    place = (c) => {
      const s = at.get(c.id);
      return s && known.has(s) ? s : KANBAN_NONE;
    };
  }
  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const c of chats) {
    const col = byId.get(place(c)) ?? byId.get(KANBAN_NONE)!;
    col.count += 1;
    if (col.cards.length < KANBAN_CARDS_PER_COLUMN) col.cards.push(c);
  }
  return {
    board: key,
    source: parsed.source,
    columns,
    readOnly,
    canEditStages: parsed.source === 'me' || (parsed.source === 'team' && isLinesAdmin(viewer)),
    truncated: Boolean(res.next),
    collapsed: await collapsedOf(viewer, key),
    hubspot: { connected: info.connected, props: info.props.map((p) => ({ name: p.name, label: p.label })) },
    ...(unlinked ? { unlinked } : {}),
  };
}

/**
 * Mueve un chat a una columna del tablero. Un chat que no ve es 404; una
 * etapa de otra persona o de otro workspace, también. En HubSpot escribe la
 * propiedad de la empresa vinculada (KANBAN_NONE la vacía).
 */
export async function moveKanbanCard(viewer: GroupsViewer, board: string, chatId: string, column: string): Promise<{ board: string; column: string }> {
  const parsed = boardSource(board);
  if (!parsed) throw new GroupsError('invalid_input');
  if (!(await canSeeChat(viewer, chatId))) throw new GroupsError('not_found', 404);
  const db = getDb();
  if (parsed.source === 'hs') {
    const info = await hubspotInfo(viewer.ws);
    const prop = info.props.find((p) => p.name === parsed.prop);
    if (!prop) throw new GroupsError('not_found', 404);
    const why = hubspotReadOnly(viewer, info, prop);
    if (why === 'hubspot_scope') {
      const { HubspotError, HUBSPOT_WRITE_SCOPE } = await import('./groups-hubspot');
      throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_WRITE_SCOPE}`, 403);
    }
    if (why === 'hubspot_read_only') throw new GroupsError('hubspot_read_only', 400);
    if (why) throw new GroupsError('forbidden', 403);
    const value = column === KANBAN_NONE ? '' : column;
    if (value && !prop.options.some((o) => o.value === value)) throw new GroupsError('invalid_input');
    const { updateHubspotCompanyProperty } = await import('./groups-hubspot-sync');
    await updateHubspotCompanyProperty(viewer.ws, viewer.me, chatId, prop.name, value);
    return { board, column: value || KANBAN_NONE };
  }
  const scope = parsed.source as StageScope;
  const owner = ownerOf(viewer, scope);
  if (column === KANBAN_NONE) {
    await db.prepare('DELETE FROM groups_kanban_cards WHERE owner_id = ? AND chat_id = ? AND user_id = ?').run(owner, chatId, viewer.ws);
    return { board, column };
  }
  const stage = await stageRow(viewer, scope, column);
  if (!stage) throw new GroupsError('not_found', 404);
  await db
    .prepare(
      `INSERT INTO groups_kanban_cards (user_id, owner_id, chat_id, stage_id, moved_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, chat_id) DO UPDATE SET stage_id = excluded.stage_id, moved_by = excluded.moved_by, updated_at = excluded.updated_at`,
    )
    .run(viewer.ws, owner, chatId, stage.id, viewer.me, nowIso());
  return { board, column: stage.id };
}
