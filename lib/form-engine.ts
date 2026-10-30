/**
 * Motor común de formularios (puro, sin DB ni React): lo comparten los
 * formularios del CRM (lib/crm-forms*.ts) y la app Forms (lib/forms/*).
 *
 * - validadores de email, teléfono y URL;
 * - comparación de condiciones sobre texto (equals, filled, …) para la
 *   lógica condicional de los dos;
 * - parámetros de URL (UTM y campos ocultos);
 * - celda CSV con guarda de fórmulas (= + - @ al principio);
 * - chequeo anti-spam de honeypot y tiempo mínimo.
 */

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{4,30}$/;

export function isEmail(v: string): boolean {
  return v.length <= 320 && EMAIL_RE.test(v);
}

export function isPhone(v: string): boolean {
  return PHONE_RE.test(v);
}

/** Solo http(s) con host. */
export function isHttpUrl(v: string): boolean {
  if (v.length > 2000) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Operadores de texto que entienden los dos motores. */
export type TextOp = 'equals' | 'not_equals' | 'filled' | 'empty' | 'contains' | 'not_contains';

/** Compara un valor (ya pasado a texto) contra el objetivo, sin distinguir mayúsculas. */
export function compareText(op: TextOp, value: string, target: string): boolean {
  const v = value.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  switch (op) {
    case 'filled':
      return v !== '';
    case 'empty':
      return v === '';
    case 'not_equals':
      return v !== t;
    case 'contains':
      return t !== '' && v.includes(t);
    case 'not_contains':
      return t === '' || !v.includes(t);
    default:
      return v === t;
  }
}

/** Parámetros de una URL (para capturar en campos ocultos). */
export function urlParamsOf(url: string | undefined): Record<string, string> {
  if (!url) return {};
  try {
    const u = new URL(url);
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      if (k.length <= 60) out[k] = v.slice(0, 500);
    });
    return out;
  } catch {
    return {};
  }
}

/**
 * Celda CSV. Un valor que empieza con = + - @ (o tab/CR) se prefija con '
 * para que la planilla no lo ejecute como fórmula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * ¿Parece spam? Honeypot completo o enviado antes del tiempo mínimo. Quien
 * llama responde "ok" sin guardar nada, para no darle pistas al bot.
 */
export function looksLikeSpam(input: { honeypot?: string | null; elapsedMs?: number | null; minSeconds: number }): boolean {
  if ((input.honeypot ?? '').trim()) return true;
  if (input.minSeconds > 0 && typeof input.elapsedMs === 'number' && input.elapsedMs < input.minSeconds * 1000) return true;
  return false;
}
