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
 * Pedidos de funciones que toma el asistente (herramienta request_feature).
 *
 * - feedback.source: de dónde vino ('form' el formulario de siempre,
 *   'assistant' el asistente). feedback.workspace_id: el workspace activo de
 *   quien lo pidió (los pedidos son internos, nunca se muestran a otro
 *   workspace).
 * - roadmap_items.priority: 1 = lo pidió alguien de FEATURE_PRIORITY_EMAILS
 *   (va primero y siempre se construye).
 * - roadmap_items.github_*: copia opcional como issue en un repo privado
 *   (BACKLOG_GITHUB_REPO). github_issue evita duplicados; github_dirty cuenta
 *   los cambios sin mandar (nuevo pedido o subida de prioridad) y el tick
 *   horario reintenta; github_claimed_at es el compare-and-set; tope de
 *   intentos en github_attempts.
 *
 * Solo columnas nuevas (addColumn): corre dos veces y en paralelo sin romper.
 */
export default {
  id: '20261119_2107_assistant_feature_requests',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE feedback ADD COLUMN source TEXT NOT NULL DEFAULT 'form'");
    await addColumn(c, 'ALTER TABLE feedback ADD COLUMN workspace_id TEXT');
    await addColumn(c, 'ALTER TABLE roadmap_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
    await addColumn(c, 'ALTER TABLE roadmap_items ADD COLUMN github_issue INTEGER');
    await addColumn(c, 'ALTER TABLE roadmap_items ADD COLUMN github_dirty INTEGER NOT NULL DEFAULT 0');
    await addColumn(c, 'ALTER TABLE roadmap_items ADD COLUMN github_claimed_at TEXT');
    await addColumn(c, 'ALTER TABLE roadmap_items ADD COLUMN github_attempts INTEGER NOT NULL DEFAULT 0');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_roadmap_items_github_dirty ON roadmap_items(github_dirty) WHERE github_dirty > 0');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_feedback_source ON feedback(source, user_id)');
  },
} satisfies Migration;
