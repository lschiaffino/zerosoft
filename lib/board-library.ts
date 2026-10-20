/**
 * Board — biblioteca de formas de Excalidraw, una por workspace: lo que
 * alguien guarda en la biblioteca (o instala desde libraries.excalidraw.com,
 * o importa de un .excalidrawlib) queda para todo el team en todas las pizarras.
 */
import { getDb } from './db';

/** Tope de la biblioteca serializada (por debajo del body de una función de Vercel). */
export const BOARD_MAX_LIBRARY_BYTES = 3 * 1024 * 1024;
export const BOARD_MAX_LIBRARY_ITEMS = 2000;

/** Ítem de la biblioteca: lo mínimo que se valida (el resto lo restaura Excalidraw). */
export function isLibraryItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const i = item as { id?: unknown; elements?: unknown };
  return typeof i.id === 'string' && i.id.length <= 128 && Array.isArray(i.elements);
}

export async function getBoardLibrary(workspaceId: string): Promise<unknown[]> {
  const row = (await getDb().prepare('SELECT items FROM board_libraries WHERE workspace_id = ?').get(workspaceId)) as
    | { items: string }
    | undefined;
  if (!row) return [];
  try {
    const items = JSON.parse(row.items) as unknown;
    return Array.isArray(items) ? items.filter(isLibraryItem) : [];
  } catch {
    return [];
  }
}

export type SaveLibraryResult = { ok: true; count: number } | { ok: false; code: 'too_large' | 'invalid_input' };

/** Reemplaza la biblioteca entera (Excalidraw manda siempre la lista completa, ya combinada). */
export async function saveBoardLibrary(workspaceId: string, personId: string, items: unknown[]): Promise<SaveLibraryResult> {
  if (items.length > BOARD_MAX_LIBRARY_ITEMS || !items.every(isLibraryItem)) return { ok: false, code: 'invalid_input' };
  const json = JSON.stringify(items);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > BOARD_MAX_LIBRARY_BYTES) return { ok: false, code: 'too_large' };
  await getDb()
    .prepare(
      `INSERT INTO board_libraries (workspace_id, items, bytes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET items = excluded.items, bytes = excluded.bytes,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, json, bytes, personId, new Date().toISOString());
  return { ok: true, count: items.length };
}
