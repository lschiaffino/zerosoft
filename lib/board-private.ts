/**
 * Board — modo privado de verdad. Lo que cada uno escribe mientras el modo
 * privado está prendido no entra a la escena compartida (no viaja en vivo, no
 * se guarda en la pizarra, no aparece en búsquedas, exports ni en el
 * navegador de los demás): queda como borrador de su autor en
 * board_private_drafts. Los demás reciben solo dónde hay notas (cajas sin
 * texto) para verlas tapadas. Al revelar, el servidor suma todos los
 * borradores a la escena en un solo guardado.
 */
import { getDb } from './db';
import { cleanElements } from './board-live';
import { getBoard, saveBoardScene } from './boards';

/** Tope por persona: alcanza para un brainstorm largo sin dejar crecer la tabla. */
export const PRIVATE_DRAFT_MAX_ELEMENTS = 400;
export const PRIVATE_DRAFT_MAX_BYTES = 512 * 1024;
const AUTHOR_RE = /^[A-Za-z0-9:_-]{1,128}$/;

type El = Record<string, unknown> & { id: string; type: string };

export interface PrivateDraftsView {
  /** Lo propio, completo (para volver a dibujarlo al abrir). */
  mine: El[];
  /** De los demás, solo dónde están (sin texto): se dibujan tapadas. */
  others: Array<{ x: number; y: number; width: number; height: number }>;
}

/** Borradores limpios: solo elementos marcados como privados de `author` y sus textos ligados. Puro. */
export function cleanDrafts(raw: unknown, author: string): El[] | null {
  if (Array.isArray(raw) && raw.length === 0) return [];
  const els = cleanElements(raw) as El[] | null;
  if (!els || els.length > PRIVATE_DRAFT_MAX_ELEMENTS) return null;
  const containers = new Set(
    els
      .filter((e) => {
        const c = e.customData as Record<string, unknown> | null | undefined;
        return c?.private === true && c?.author === author && e.type !== 'text';
      })
      .map((e) => e.id),
  );
  return els.filter((e) => containers.has(e.id) || (e.type === 'text' && typeof e.containerId === 'string' && containers.has(e.containerId)));
}

/** Lo que ve `me` de los borradores de la pizarra. Puro. */
export function draftsView(rows: ReadonlyArray<{ author: string; elements: El[] }>, me: string | null): PrivateDraftsView {
  const mine: El[] = [];
  const others: PrivateDraftsView['others'] = [];
  for (const r of rows) {
    if (me && r.author === me) {
      mine.push(...r.elements);
      continue;
    }
    for (const e of r.elements) {
      if (e.type === 'text' || e.isDeleted) continue;
      others.push({ x: Number(e.x) || 0, y: Number(e.y) || 0, width: Math.abs(Number(e.width) || 0), height: Math.abs(Number(e.height) || 0) });
    }
  }
  return { mine, others };
}

/** Elemento revelado: sin la marca de privado y con la versión subida (gana al merge por elemento). Puro. */
export function revealed(el: El): El {
  const c = { ...((el.customData as Record<string, unknown> | null) ?? {}) };
  delete c.private;
  return { ...el, customData: c, version: (Number(el.version) || 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() };
}

export async function savePrivateDrafts(boardId: string, author: string, elements: El[]): Promise<'ok' | 'invalid' | 'too_large'> {
  if (!AUTHOR_RE.test(author)) return 'invalid';
  const json = JSON.stringify(elements);
  if (Buffer.byteLength(json, 'utf8') > PRIVATE_DRAFT_MAX_BYTES) return 'too_large';
  const db = getDb();
  if (!elements.length) {
    await db.prepare('DELETE FROM board_private_drafts WHERE board_id = ? AND author = ?').run(boardId, author);
    return 'ok';
  }
  await db
    .prepare(
      `INSERT INTO board_private_drafts (board_id, author, elements, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(board_id, author) DO UPDATE SET elements = excluded.elements, updated_at = excluded.updated_at`,
    )
    .run(boardId, author, json, new Date().toISOString());
  return 'ok';
}

export async function listPrivateDrafts(boardId: string): Promise<Array<{ author: string; elements: El[] }>> {
  const rows = (await getDb().prepare('SELECT author, elements FROM board_private_drafts WHERE board_id = ?').all(boardId)) as Array<{
    author: string;
    elements: string;
  }>;
  return rows.map((r) => {
    try {
      const els = JSON.parse(r.elements) as unknown;
      return { author: r.author, elements: Array.isArray(els) ? (els as El[]) : [] };
    } catch {
      return { author: r.author, elements: [] };
    }
  });
}

/**
 * Revela: suma los borradores de todos a la escena (un guardado, reintenta si
 * alguien guardó en el medio) y los borra. Devuelve la versión nueva, o null
 * si no había nada que sumar.
 */
export async function revealPrivateDrafts(workspaceId: string, boardId: string, personId: string | null): Promise<number | null> {
  const rows = await listPrivateDrafts(boardId);
  const drafts = rows.flatMap((r) => r.elements).map(revealed);
  if (!drafts.length) {
    await getDb().prepare('DELETE FROM board_private_drafts WHERE board_id = ?').run(boardId);
    return null;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const board = await getBoard(workspaceId, boardId);
    if (!board) return null;
    const ids = new Set(drafts.map((d) => d.id));
    const elements = [...(board.scene.elements as El[]).filter((e) => !ids.has(e.id)), ...drafts];
    const res = await saveBoardScene(workspaceId, personId, boardId, { ...board.scene, elements }, board.version);
    if (res.ok) {
      await getDb().prepare('DELETE FROM board_private_drafts WHERE board_id = ?').run(boardId);
      return res.version;
    }
    if (res.code !== 'conflict') return null;
  }
  return null;
}
