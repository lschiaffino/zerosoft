import type { Migration } from '../migrations';

/**
 * Lines: desde cuándo una línea está en su estado (conectada, desconectada…),
 * para la tabla de Ajustes › Números. Se escribe cuando el estado cambia
 * (saveState en lib/groups.ts) y al crear la línea. Las líneas que ya existían
 * quedan en NULL hasta su próximo cambio: no se sabe desde cuándo están así.
 * Idempotente: la columna se agrega ignorando "duplicate column".
 */
export default {
  id: '20261118_2106_lines_number_status_since',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE groups_numbers ADD COLUMN status_since TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
