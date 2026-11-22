/** Filas por página de los listados del CRM (`per` en la URL), como las de HubSpot. La primera es la de siempre. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** El tamaño pedido si es uno de los permitidos; si no, el de siempre. */
export function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
}
