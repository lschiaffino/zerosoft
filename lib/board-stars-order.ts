/** Orden de la lista de Board: puro, sin base de datos, para usarlo también en el cliente. */
/** Las destacadas primero; dentro de cada grupo se conserva el orden que traía la lista. */
export function starredFirst<T extends { id: string }>(items: readonly T[], starred: ReadonlySet<string>): T[] {
  return [...items.filter((b) => starred.has(b.id)), ...items.filter((b) => !starred.has(b.id))];
}
