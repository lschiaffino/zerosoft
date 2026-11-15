import type { Migration } from '../migrations';

/**
 * Docs › Notion: la verificación del webhook queda atada al workspace y a la
 * persona que la abrió (`workspace_id`, `opened_by` en la ventana, en cada
 * token candidato y en el secreto confirmado). Las ventanas viejas sin dueño
 * se descartan: hay que volver a abrirlas desde Ajustes.
 */
export default {
  id: '20261115_1420_notion_webhook_owner',
  up: async (c) => {
    for (const sql of ['ALTER TABLE notion_sync_webhook ADD COLUMN workspace_id TEXT', 'ALTER TABLE notion_sync_webhook ADD COLUMN opened_by TEXT']) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.execute(`DELETE FROM notion_sync_webhook WHERE id = 'window' AND workspace_id IS NULL`);
  },
} satisfies Migration;
