/**
 * Escalas de estimación por team, como Linear (Settings del team ›
 * Estimates). Se guarda en track_projects.estimate_scale; el valor que se
 * guarda en el issue es siempre un número (los talles de remera mapean a
 * puntos: XS 1, S 2, M 3, L 5, XL 8).
 */

export const ESTIMATE_SCALES = ['fibonacci', 'linear', 'exponential', 'tshirt', 'none'] as const;
export type EstimateScale = (typeof ESTIMATE_SCALES)[number];

const TSHIRT: Array<{ value: number; label: string }> = [
  { value: 1, label: 'XS' },
  { value: 2, label: 'S' },
  { value: 3, label: 'M' },
  { value: 5, label: 'L' },
  { value: 8, label: 'XL' },
];

export function isEstimateScale(v: unknown): v is EstimateScale {
  return typeof v === 'string' && (ESTIMATE_SCALES as readonly string[]).includes(v);
}

/**
 * Opciones del menú de estimación (⇧E) para la escala del team. `label` es
 * el número como texto salvo en talles (XS…XL). Con `none`, ninguna.
 */
export function estimateOptions(scale: string | null | undefined): Array<{ value: number; label: string }> {
  const s: EstimateScale = isEstimateScale(scale) ? scale : 'fibonacci';
  const nums = (list: number[]) => list.map((value) => ({ value, label: String(value) }));
  switch (s) {
    case 'linear':
      return nums([1, 2, 3, 4, 5]);
    case 'exponential':
      return nums([1, 2, 4, 8, 16]);
    case 'tshirt':
      return TSHIRT;
    case 'none':
      return [];
    default:
      return nums([0, 1, 2, 3, 5, 8]);
  }
}

/** Texto de una estimación guardada según la escala (5 → "L" en talles). */
export function estimateLabel(value: number, scale: string | null | undefined): string {
  if (scale === 'tshirt') return TSHIRT.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}
