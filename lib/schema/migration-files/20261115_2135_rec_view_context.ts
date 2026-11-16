import type { Migration } from '../migrations';
import { recViewContextUp } from '../rec-view-context-migration';

/**
 * Rec: país, región, ciudad, dispositivo, navegador, sistema y origen de cada
 * vista, re-vistas por tramo y número de espectador. Borra el user agent y el
 * hash de IP ya guardados (lib/schema/rec-view-context-migration.ts).
 * Idempotente: columnas con addColumn e índice IF NOT EXISTS.
 */
export default {
  id: '20261115_2135_rec_view_context',
  up: recViewContextUp,
} satisfies Migration;
