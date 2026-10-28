/**
 * Board: operaciones para la API REST (/api/v1/boards) y el servidor MCP,
 * con la key actuando como la persona que la creó: ve y edita lo mismo que
 * ella en la app (pizarras restringidas incluidas), deja registro con `via`
 * y avisa en vivo a quien tenga la pizarra abierta. Server-only.
 */
import { accessAtLeast, boardViewer, getBoardAccess, type BoardViewer } from './board-access';
import {
  createBoard,
  getBoard,
  getBoardName,
  listBoards,
  moveBoardToFolder,
  renameBoard,
  saveBoardScene,
  searchBoards,
  trashBoard,
} from './boards';
import { BOARD_TEMPLATES, buildSpecElements, buildTemplateScene, type BoardTemplateKey, type ElementSpec, type TemplateText } from './board-templates';
import { STICKY_H, STICKY_W, layoutStickiesInFreeSpace, stickyFill, elementText, isSticky, type SceneEl } from './board-stickies';
import { logBoardAudit, type BoardAuditVia } from './board-audit';
import { getBoardFolder } from './board-folders';
import { sanitizeElements } from './board-import';
import { publishBoardAccessChanged, publishBoardEvent } from './board-live';
import { orderFrames, type FrameLike } from './board-present';
import type { BoardSummary } from './boards-types';
import type { TeamRole } from './teams';
import en from '@/messages/en/board.json';
import es from '@/messages/es/board.json';
import pt from '@/messages/pt/board.json';

export class BoardApiError extends Error {
  constructor(
    public code: 'not_found' | 'forbidden' | 'invalid_input' | 'conflict' | 'too_large',
    public status: number,
  ) {
    super(code);
    this.name = 'BoardApiError';
  }
}

export interface BoardActor {
  ws: string;
  personId: string;
  role: TeamRole;
  via: BoardAuditVia;
}

function viewerOf(a: BoardActor): BoardViewer {
  return boardViewer({ id: a.ws, actingUser: a.personId === a.ws ? null : { id: a.personId }, role: a.role });
}

async function need(a: BoardActor, id: string, level: 'view' | 'edit' | 'manage') {
  const got = await getBoardAccess(viewerOf(a), id);
  if (!got) throw new BoardApiError('not_found', 404);
  if (!accessAtLeast(got, level)) throw new BoardApiError('forbidden', 403);
  return got;
}

const MESSAGES: Record<string, unknown> = { en, es, pt };
function templateText(locale: string): TemplateText {
  const messages = (MESSAGES[locale] ?? MESSAGES.en) as { templates?: Record<string, unknown> };
  return (key) => {
    let node: unknown = messages.templates;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === 'string' ? node : key;
  };
}

/** Forma pública de una pizarra (sin tokens de links ni miniatura). */
export function publicBoard(b: BoardSummary) {
  return {
    id: b.id,
    name: b.name,
    folderId: b.folder_id ?? null,
    access: b.access,
    version: b.version,
    updatedAt: b.updated_at,
    createdAt: b.created_at,
    updatedBy: b.updated_by,
    ...(b.match ? { match: b.match } : {}),
  };
}

export async function apiListBoards(a: BoardActor, opts: { q?: string; folderId?: string | null; limit?: number } = {}) {
  const viewer = viewerOf(a);
  const rows = opts.q?.trim() ? await searchBoards(a.ws, viewer, opts.q, opts.limit ?? 50) : await listBoards(a.ws, viewer);
  const filtered = opts.folderId ? rows.filter((b) => b.folder_id === opts.folderId) : rows;
  return filtered.slice(0, Math.min(Math.max(opts.limit ?? 50, 1), 200)).map(publicBoard);
}

/** Lo que dice la pizarra, para un agente: frames en orden, stickies con sus etiquetas y textos sueltos. */
export function boardOutline(elements: readonly unknown[]) {
  const els = elements as SceneEl[];
  const byId = new Map(els.map((e) => [e.id, e]));
  const frames = orderFrames<FrameLike>(elements).map((f) => ({ id: f.id, name: f.name ?? null }));
  const stickies = els
    .filter((e) => isSticky(e))
    .map((e) => ({ id: e.id, text: elementText(e, byId), tags: Array.isArray(e.customData?.tags) ? (e.customData?.tags as string[]) : [], frameId: (e as { frameId?: string | null }).frameId ?? null }));
  const texts = els
    .filter((e) => e.type === 'text' && !(e as { containerId?: string | null }).containerId && !e.isDeleted)
    .map((e) => ({ id: e.id, text: String((e as { text?: string }).text ?? '') }));
  return { frames, stickies, texts, elementCount: els.filter((e) => !e.isDeleted).length };
}

export async function apiGetBoard(a: BoardActor, id: string, withScene = false) {
  const access = await need(a, id, 'view');
  const board = await getBoard(a.ws, id);
  if (!board) throw new BoardApiError('not_found', 404);
  return {
    ...publicBoard(board),
    myAccess: access,
    outline: boardOutline(board.scene.elements),
    ...(withScene ? { scene: { elements: sanitizeElements(board.scene.elements as Array<Record<string, unknown>>), appState: board.scene.appState } } : {}),
  };
}

export async function apiCreateBoard(a: BoardActor, input: { name?: string; template?: string; folderId?: string | null; locale?: string }) {
  // La carpeta se valida antes de crear: un id ajeno o inventado no deja una pizarra a medias.
  if (input.folderId && !(await getBoardFolder(a.ws, input.folderId))) throw new BoardApiError('invalid_input', 400);
  let scene;
  if (input.template) {
    if (!(BOARD_TEMPLATES as readonly string[]).includes(input.template)) throw new BoardApiError('invalid_input', 400);
    scene = buildTemplateScene(input.template as BoardTemplateKey, templateText(input.locale ?? 'en'));
  }
  const board = await createBoard(a.ws, a.personId, input.name ?? '', { scene, folderId: input.folderId ?? null });
  await logBoardAudit({ workspaceId: a.ws, actorId: a.personId, via: a.via, action: 'board.created', boardId: board.id, boardName: board.name, data: input.template ? { template: input.template } : {} });
  return publicBoard({ ...board, folder_id: input.folderId ?? null });
}

export async function apiUpdateBoard(a: BoardActor, id: string, input: { name?: string; folderId?: string | null }) {
  await need(a, id, 'edit');
  if (input.name !== undefined) {
    const clean = input.name.trim();
    if (!clean) throw new BoardApiError('invalid_input', 400);
    const before = await getBoardName(a.ws, id);
    await renameBoard(a.ws, id, clean.slice(0, 120), a.personId);
    await logBoardAudit({ workspaceId: a.ws, actorId: a.personId, via: a.via, action: 'board.renamed', boardId: id, boardName: clean, data: { from: before } });
  }
  if (input.folderId !== undefined) {
    const res = await moveBoardToFolder(a.ws, id, input.folderId);
    if (res === 'no_folder') throw new BoardApiError('invalid_input', 400);
    await logBoardAudit({ workspaceId: a.ws, actorId: a.personId, via: a.via, action: 'board.moved', boardId: id, boardName: await getBoardName(a.ws, id), data: { folderId: input.folderId } });
  }
  return apiGetBoard(a, id);
}

/** A la papelera (como en la app: una restringida solo la borra quien la gestiona). */
export async function apiTrashBoard(a: BoardActor, id: string) {
  const access = await need(a, id, 'edit');
  const board = await getBoard(a.ws, id);
  if (!board) throw new BoardApiError('not_found', 404);
  if (board.access === 'restricted' && access !== 'manage') throw new BoardApiError('forbidden', 403);
  await trashBoard(a.ws, id, a.personId);
  await publishBoardAccessChanged(a.ws, id);
  await logBoardAudit({ workspaceId: a.ws, actorId: a.personId, via: a.via, action: 'board.trashed', boardId: id, boardName: board.name });
}

export interface AddElementsInput {
  stickies?: Array<{ text: string; color?: string; tags?: string[] }>;
  elements?: Array<Omit<ElementSpec, 'x' | 'y'> & { x?: number; y?: number }>;
  connect?: Array<{ from: number; to: number }>;
}

/**
 * Suma stickies y formas a la escena guardada (sin tocar lo que hay). Lo que
 * no trae posición va a un hueco libre al lado del contenido. Reintenta si
 * alguien guardó en el medio y avisa a las pestañas abiertas para que lo traigan.
 */
export async function apiAddElements(a: BoardActor, id: string, input: AddElementsInput) {
  await need(a, id, 'edit');
  const specsIn: Array<Omit<ElementSpec, 'x' | 'y'> & { x?: number; y?: number }> = [
    ...(input.stickies ?? []).map((s) => ({ kind: 'sticky' as const, text: s.text, fill: stickyFill(s.color), tags: s.tags })),
    ...(input.elements ?? []),
  ];
  if (!specsIn.length || specsIn.length > 200) throw new BoardApiError('invalid_input', 400);
  for (let attempt = 0; attempt < 3; attempt++) {
    const board = await getBoard(a.ws, id);
    if (!board) throw new BoardApiError('not_found', 404);
    const occupied = (board.scene.elements as Array<{ x?: number; y?: number; width?: number; height?: number; isDeleted?: boolean }>)
      .filter((e) => !e.isDeleted)
      .map((e) => ({ x: Number(e.x ?? 0), y: Number(e.y ?? 0), width: Number(e.width ?? 0), height: Number(e.height ?? 0) }));
    const right = occupied.length ? Math.max(...occupied.map((o) => o.x + o.width)) : 0;
    const top = occupied.length ? Math.min(...occupied.map((o) => o.y)) : 0;
    const unplaced = specsIn.filter((s) => s.x === undefined || s.y === undefined).length;
    const slots = layoutStickiesInFreeSpace(unplaced, { x: right + 120 + STICKY_W, y: top + STICKY_H }, occupied);
    let k = 0;
    const specs: ElementSpec[] = specsIn.map((s) => {
      if (s.x !== undefined && s.y !== undefined) return { ...s, x: s.x, y: s.y };
      const pos = slots[k++] ?? { x: right + 120, y: top };
      return { ...s, x: pos.x, y: pos.y };
    });
    const added = buildSpecElements(specs, input.connect ?? []);
    const res = await saveBoardScene(a.ws, a.personId, id, { ...board.scene, elements: [...board.scene.elements, ...added] }, board.version);
    if (res.ok) {
      await publishBoardEvent({ boardId: id, workspaceId: a.ws, socketId: 'server', kind: 'saved', user: { id: a.personId, name: null, guest: false }, payload: { version: res.version } }).catch(() => undefined);
      return { version: res.version, added: added.filter((e) => e.type !== 'text' || !e.containerId).map((e) => ({ id: e.id, type: e.type })) };
    }
    if (res.code === 'too_large') throw new BoardApiError('too_large', 413);
    if (res.code === 'not_found') throw new BoardApiError('not_found', 404);
  }
  throw new BoardApiError('conflict', 409);
}
