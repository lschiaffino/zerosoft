/**
 * CRM — diálogo de ganado (puro: lo usan el client y los tests). Ganar un deal
 * pide la fecha de cierre (precargada con hoy) y lo que exija la etapa, en un
 * solo formulario.
 */

interface FieldLike {
  key: string;
  type: string;
}

/** Hoy en la zona del navegador, como YYYY-MM-DD (lo que espera un input date). */
export function todayIso(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** La fecha de cierre va siempre y primero; después lo que pida la etapa (sin repetirla). */
export function wonRequirements<F extends FieldLike>(req: { stage: string; missing: F[] }): { stage: string; missing: F[] } {
  const rest = req.missing.filter((f) => f.key !== 'closeDate');
  return { stage: req.stage, missing: [{ key: 'closeDate', type: 'closeDate' } as F, ...rest] };
}
