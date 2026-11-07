/**
 * Track: la plantilla predeterminada de un proyecto. Pura, para que la use
 * tanto el quick-create (cliente) como los tests.
 */
export function pickDefaultTemplate<T extends { id: string; is_default?: number | null }>(templates: readonly T[]): T | undefined {
  return templates.find((tpl) => tpl.is_default === 1);
}
