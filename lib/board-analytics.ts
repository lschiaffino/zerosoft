/**
 * Board, analítica con el kit (el formato de Lines): pizarras creadas y
 * editadas, quién edita y cuándo, colaboradores, comentarios y elementos de
 * las pizarras que la persona ve (las restringidas solo si es admin, la creó
 * o es invitada), en un período contra el anterior.
 *
 * Ediciones: una por persona, pizarra y hora (board_edit_marks, más las fotos
 * del historial y el último guardado de cada pizarra, para lo de antes de las
 * marcas).
 */
import { getDb } from './db';
import { boardVisibleSql, type BoardViewer } from './board-access';
import { markHour } from './edit-marks';
import { dedupeEdits, heatAdd, stampMs } from './docs-analytics';
import { analyticsRange, daySeries, localDay, rangeInfo, type AnalyticsRange, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export interface BoardIn {
  id: string;
  name: string;
  folder_id: string | null;
  created_at: string;
  /** Elementos (sin los borrados) ahora. */
  elements: number;
}

export interface BoardEditIn {
  board_id: string;
  person_id: string;
  at: number;
}

export interface BoardCommentIn {
  board_id: string;
  author_id: string | null;
  created_at: string;
}

export interface BoardDay {
  day: string;
  created: number;
  edits: number;
  comments: number;
}

export interface BoardPersonStat {
  id: string;
  name: string;
  edits: number;
  boards: number;
  comments: number;
  prevEdits: number;
}

export interface BoardStat {
  id: string;
  name: string;
  edits: number;
  editors: number;
  comments: number;
  elements: number;
  lastEditAt: number | null;
}

export interface BoardFolderStat {
  id: string;
  name: string;
  edits: number;
  created: number;
  boards: number;
}

export interface BoardAnalytics {
  range: RangeInfo;
  kpis: { created: Kpi; edited: Kpi; edits: Kpi; people: Kpi; comments: Kpi; elements: Kpi };
  perDay: BoardDay[];
  heat: number[][];
  people: BoardPersonStat[];
  boards: BoardStat[];
  folders: BoardFolderStat[];
  folderList: Array<{ id: string; name: string }>;
  boardCount: number;
}

export interface BoardAnalyticsInput {
  boards: BoardIn[];
  edits: BoardEditIn[];
  comments: BoardCommentIn[];
  names: Map<string, string>;
  folders: Array<{ id: string; name: string }>;
}

const inFolder = (b: Pick<BoardIn, 'folder_id'>, folder: string | undefined) => !folder || (folder === 'none' ? !b.folder_id : b.folder_id === folder);

/** Agrega lo leído (puro: lo prueban los tests). */
export function aggregateBoard(range: AnalyticsRange, input: BoardAnalyticsInput, folder?: string): BoardAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const folderNames = new Map(input.folders.map((f) => [f.id, f.name]));
  const boards = new Map(input.boards.filter((b) => inFolder(b, folder)).map((b) => [b.id, b]));
  const byDay = new Map<string, Omit<BoardDay, 'day'>>();
  const bump = (ms: number, k: keyof Omit<BoardDay, 'day'>) => {
    const day = localDay(ms, range.tz);
    const v = byDay.get(day) ?? { created: 0, edits: 0, comments: 0 };
    v[k] += 1;
    byDay.set(day, v);
  };
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const stats = new Map<string, BoardStat & { editorSet: Set<string> }>();
  const stat = (b: BoardIn) => {
    let s = stats.get(b.id);
    if (!s) stats.set(b.id, (s = { id: b.id, name: b.name, edits: 0, editors: 0, comments: 0, elements: b.elements, lastEditAt: null, editorSet: new Set() }));
    return s;
  };
  const folderStats = new Map<string, BoardFolderStat & { boardSet: Set<string> }>();
  const folderStat = (b: BoardIn) => {
    const id = b.folder_id && folderNames.has(b.folder_id) ? b.folder_id : '';
    let s = folderStats.get(id);
    if (!s) folderStats.set(id, (s = { id, name: folderNames.get(id) ?? '', edits: 0, created: 0, boards: 0, boardSet: new Set() }));
    return s;
  };
  const people = new Map<string, BoardPersonStat & { boardSet: Set<string> }>();
  const person = (id: string) => {
    let s = people.get(id);
    if (!s) people.set(id, (s = { id, name: input.names.get(id) ?? '', edits: 0, boards: 0, comments: 0, prevEdits: 0, boardSet: new Set() }));
    return s;
  };
  const created = { cur: 0, prev: 0 };
  for (const b of boards.values()) {
    const ms = stampMs(b.created_at);
    if (!(ms >= prevSince && ms < until)) continue;
    bump(ms, 'created');
    if (ms < since) created.prev += 1;
    else {
      created.cur += 1;
      folderStat(b).created += 1;
    }
  }
  const edited = { cur: new Set<string>(), prev: new Set<string>() };
  const edits = { cur: 0, prev: 0 };
  const who = { cur: new Set<string>(), prev: new Set<string>() };
  for (const e of input.edits) {
    const b = boards.get(e.board_id);
    if (!b || !(e.at >= prevSince && e.at < until)) continue;
    bump(e.at, 'edits');
    if (e.at < since) {
      edits.prev += 1;
      edited.prev.add(e.board_id);
      if (e.person_id) {
        who.prev.add(e.person_id);
        person(e.person_id).prevEdits += 1;
      }
      continue;
    }
    edits.cur += 1;
    edited.cur.add(e.board_id);
    heatAdd(heat, e.at, range.tz);
    const s = stat(b);
    s.edits += 1;
    s.lastEditAt = Math.max(s.lastEditAt ?? 0, e.at);
    const f = folderStat(b);
    f.edits += 1;
    f.boardSet.add(b.id);
    if (e.person_id) {
      s.editorSet.add(e.person_id);
      who.cur.add(e.person_id);
    }
    const p = person(e.person_id);
    p.edits += 1;
    p.boardSet.add(b.id);
  }
  const comments = { cur: 0, prev: 0 };
  for (const c of input.comments) {
    const b = boards.get(c.board_id);
    const ms = stampMs(c.created_at);
    if (!b || !(ms >= prevSince && ms < until)) continue;
    bump(ms, 'comments');
    if (ms < since) {
      comments.prev += 1;
      if (c.author_id) who.prev.add(c.author_id);
      continue;
    }
    comments.cur += 1;
    stat(b).comments += 1;
    if (c.author_id) {
      who.cur.add(c.author_id);
      person(c.author_id).comments += 1;
    }
  }
  const { cur: perDay } = daySeries(range, byDay, () => ({ created: 0, edits: 0, comments: 0 }));
  return {
    range: rangeInfo(range),
    kpis: {
      created: { value: created.cur, prev: created.prev },
      edited: { value: edited.cur.size, prev: edited.prev.size },
      edits: { value: edits.cur, prev: edits.prev },
      people: { value: who.cur.size, prev: who.prev.size },
      comments: { value: comments.cur, prev: comments.prev },
      elements: { value: [...boards.values()].reduce((a, b) => a + (Number(b.elements) || 0), 0) },
    },
    perDay,
    heat,
    people: [...people.values()]
      .filter((p) => p.edits + p.comments + p.prevEdits > 0)
      .map(({ boardSet, ...p }) => ({ ...p, boards: boardSet.size }))
      .sort((a, b) => b.edits - a.edits || b.comments - a.comments || a.name.localeCompare(b.name)),
    boards: [...stats.values()]
      .map(({ editorSet, ...s }) => ({ ...s, editors: editorSet.size }))
      .sort((a, b) => b.edits - a.edits || b.comments - a.comments || a.name.localeCompare(b.name))
      .slice(0, 50),
    folders: [...folderStats.values()]
      .map(({ boardSet, ...f }) => ({ ...f, boards: boardSet.size }))
      .filter((f) => f.edits + f.created > 0)
      .sort((a, b) => b.edits - a.edits || b.created - a.created || a.name.localeCompare(b.name)),
    folderList: input.folders,
    boardCount: boards.size,
  };
}

/** La analítica de Board de las pizarras que ve quien mira (o de una carpeta). */
export async function boardAnalytics(viewer: BoardViewer, folder: string | undefined, query: RangeInput = {}, now = new Date()): Promise<BoardAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  const ws = viewer.workspaceId;
  const vis = boardVisibleSql(viewer);
  const from = new Date(Date.parse(range.prevSince) - 86_400_000).toISOString();
  const visible = `SELECT b.id FROM boards b WHERE b.workspace_id = ? AND ${vis.sql}`;
  const visArgs = [ws, ...vis.args];
  const [boards, marks, snaps, last, comments, folders] = await Promise.all([
    db
      .prepare(
        `SELECT b.id, b.name, b.folder_id, b.created_at,
           CASE WHEN json_valid(b.scene) THEN (SELECT COUNT(*) FROM json_each(b.scene, '$.elements') e WHERE COALESCE(json_extract(e.value, '$.isDeleted'), 0) = 0) ELSE 0 END AS elements
         FROM boards b WHERE b.workspace_id = ? AND ${vis.sql} LIMIT 2000`,
      )
      .all(...visArgs) as Promise<BoardIn[]>,
    db
      .prepare(`SELECT board_id AS page_id, person_id, hour FROM board_edit_marks WHERE workspace_id = ? AND hour >= ? AND board_id IN (${visible}) LIMIT 100000`)
      .all(ws, markHour(new Date(from)), ...visArgs) as Promise<Array<{ page_id: string; person_id: string; hour: string }>>,
    db
      .prepare(`SELECT board_id, edited_by, content_at FROM board_snapshots WHERE workspace_id = ? AND content_at >= ? AND board_id IN (${visible}) LIMIT 100000`)
      .all(ws, from, ...visArgs) as Promise<Array<{ board_id: string; edited_by: string | null; content_at: string }>>,
    db
      .prepare(`SELECT b.id AS board_id, b.updated_by AS edited_by, b.updated_at AS content_at FROM boards b WHERE b.workspace_id = ? AND ${vis.sql} AND b.updated_at >= ? AND b.version > 1`)
      .all(...visArgs, from) as Promise<Array<{ board_id: string; edited_by: string | null; content_at: string }>>,
    db
      .prepare(`SELECT board_id, author_id, created_at FROM board_comments WHERE created_at >= ? AND board_id IN (${visible}) LIMIT 100000`)
      .all(from, ...visArgs) as Promise<BoardCommentIn[]>,
    db.prepare('SELECT id, name FROM board_folders WHERE workspace_id = ? ORDER BY name').all(ws) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const hourOf = (v: string) => {
    const ms = stampMs(v);
    return Number.isFinite(ms) ? markHour(new Date(ms)) : '';
  };
  const edits = dedupeEdits([...marks, ...[...snaps, ...last].map((s) => ({ page_id: s.board_id, person_id: s.edited_by, hour: hourOf(s.content_at) }))]).map((e) => ({
    board_id: e.page_id,
    person_id: e.person_id,
    at: e.at,
  }));
  const ids = [...new Set([...edits.map((e) => e.person_id), ...comments.map((c) => c.author_id ?? '')].filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) as Array<{ id: string; name: string | null; email: string }>;
    for (const r of rows) names.set(r.id, r.name?.trim() || r.email);
  }
  // Solo las carpetas con alguna pizarra que la persona ve (una carpeta de restringidas ajenas no se nombra).
  const seen = new Set(boards.map((b) => b.folder_id).filter(Boolean));
  const folderList = folders.filter((f) => viewer.isAdmin || seen.has(f.id));
  const folderId = folder && (folder === 'none' || folderList.some((f) => f.id === folder)) ? folder : undefined;
  return aggregateBoard(range, { boards: boards.map((b) => ({ ...b, elements: Number(b.elements) || 0 })), edits, comments, names, folders: folderList }, folderId);
}

export function isBoardAnalyticsEmpty(d: BoardAnalytics): boolean {
  const k = d.kpis;
  return d.boardCount === 0 || !(k.created.value || k.edits.value || k.comments.value || k.created.prev || k.edits.prev || k.comments.prev);
}

const cache = shortCache<BoardAnalytics>();

/** Con la caché corta del kit. La clave lleva el workspace, quién mira (ve otras pizarras), la carpeta y el rango. */
export function cachedBoardAnalytics(viewer: BoardViewer, folder: string | undefined, query: RangeInput = {}): Promise<BoardAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([viewer.workspaceId, viewer.personId, viewer.isAdmin, folder ?? '', r.since, r.until, r.tz]), () => boardAnalytics(viewer, folder, query, now));
}

export function clearBoardAnalyticsCache(): void {
  cache.clear();
}
