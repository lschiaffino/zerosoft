import type { Migration } from '../migrations';
import { booksParityUp } from '../books-parity-migration';

/**
 * Books: impuesto incluido, cobros por lote, presupuestos, bienes de uso,
 * reglas bancarias, centros de costo y portal de cliente
 * (lib/schema/books-parity-migration.ts). Idempotente: columnas con addColumn
 * y tablas e índices IF NOT EXISTS.
 */
export default {
  id: '20261118_0902_books_parity',
  up: booksParityUp,
} satisfies Migration;
