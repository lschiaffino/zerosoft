/**
 * Lo que vuelve de un guardado, aplicado sobre un editor que se siguió usando
 * mientras el pedido estaba en vuelo.
 *
 * Campo por campo: si el campo sigue igual a lo que se mandó, toma el valor del
 * servidor (que puede venir normalizado o con datos nuevos, como un id); si la
 * persona lo cambió mientras tanto, queda lo suyo. El llamador compara después
 * el resultado contra lo guardado y sabe que sigue habiendo cambios sin guardar.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function mergeSaved<T extends object>(current: T, sent: T, saved: T): T {
  if (sameValue(current, sent)) return saved;
  const out = { ...saved };
  for (const key of Object.keys(current) as Array<keyof T>) {
    if (!sameValue(current[key], sent[key])) out[key] = current[key];
  }
  return out;
}
