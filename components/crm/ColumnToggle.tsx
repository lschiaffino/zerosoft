'use client';

import { IndexEditColumns } from './EditColumns';

/**
 * "Editar columnas" dentro de la barra de filtros, al lado del orden. Lo
 * dibuja la barra misma (con las columnas de TableColumnsProvider), así sale
 * con la página y no cuando monta la tabla.
 */
export function ColumnsSlot() {
  return (
    <div className="filter-columns">
      <IndexEditColumns />
    </div>
  );
}
