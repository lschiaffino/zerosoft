import type { Migration } from '../migrations';

/**
 * Docs y Board: quién editó qué y cuándo, para la analítica
 * (lib/docs-analytics.ts, lib/board-analytics.ts). Una fila por página o
 * pizarra, persona y hora UTC ('YYYY-MM-DDTHH'), con cuántos guardados hubo.
 * El historial de versiones se poda (50 versiones por página, 30 días por
 * pizarra): esto no, y es chico (una fila por hora de edición).
 */
export default {
  id: '20261117_1552_docs_board_edit_marks',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS docs_edit_marks (
        workspace_id TEXT NOT NULL,
        page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL DEFAULT '',
        hour TEXT NOT NULL,
        saves INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (page_id, person_id, hour)
      );
      CREATE INDEX IF NOT EXISTS idx_docs_edit_marks_ws ON docs_edit_marks(workspace_id, hour);
      CREATE TABLE IF NOT EXISTS board_edit_marks (
        workspace_id TEXT NOT NULL,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL DEFAULT '',
        hour TEXT NOT NULL,
        saves INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (board_id, person_id, hour)
      );
      CREATE INDEX IF NOT EXISTS idx_board_edit_marks_ws ON board_edit_marks(workspace_id, hour);
    `);
  },
} satisfies Migration;
