import type { Migration } from '../migrations';

/**
 * Rec: tira de miniaturas para la vista previa al pasar por la línea de tiempo
 * (como YouTube o Loom). La arma el mismo trabajo que el MP4 (lib/rec-mp4.ts) y
 * vale para la misma versión (mp4_for). sprite_meta: JSON con cada cuántos
 * segundos va un cuadro, columnas, cantidad y tamaño de cada cuadro.
 */
export default {
  id: '20261115_0236_rec_sprite',
  up: async (c) => {
    for (const sql of ['ALTER TABLE rec_videos ADD COLUMN sprite_url TEXT', 'ALTER TABLE rec_videos ADD COLUMN sprite_meta TEXT']) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
