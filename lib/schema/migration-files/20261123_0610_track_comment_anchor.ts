import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * Comentarios en línea sobre la descripción de un issue (como Linear): el
 * comentario raíz guarda el texto elegido (anchor_text). La descripción lo
 * resalta mientras el hilo no esté resuelto.
 */
export default {
  id: '20261123_0610_track_comment_anchor',
  async up(client) {
    await addColumn(client, 'ALTER TABLE track_issue_comments ADD COLUMN anchor_text TEXT');
  },
} satisfies Migration;
