'use client';

/** Id del lugar en la barra de filtros donde va "Editar columnas" (al lado del orden; ver EditColumns.tsx). */
export const COLUMNS_SLOT_ID = 'crm-columns-slot';

/** Lugar para "Editar columnas" dentro de la barra de filtros. */
export function ColumnsSlot() {
  return <div id={COLUMNS_SLOT_ID} className="filter-columns" />;
}
