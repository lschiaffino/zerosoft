import type { Migration } from '../migrations';

/**
 * Lines: color elegible por línea (lib/line-colors.ts). '' = sin color.
 * Idempotente: la columna se agrega ignorando "duplicate column".
 */
export default {
  id: '20261118_2032_lines_line_color',
  up: async (c) => {
    try {
      await c.execute("ALTER TABLE groups_numbers ADD COLUMN color TEXT NOT NULL DEFAULT ''");
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;
