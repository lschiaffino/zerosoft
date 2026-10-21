/**
 * TOTP (RFC 6238) — validación del secreto que se guarda en una credencial.
 * Puro (sin crypto de Node): lo usan la API, el diálogo de credenciales y los
 * tests. El código en sí lo calcula el intérprete de Robots dentro del
 * navegador del robot (lib/robots-interpreter.ts), en el momento de usarlo.
 *
 * Formato guardado: "BASE32" (SHA-1, 6 dígitos, 30 s, lo de casi todos los
 * sitios) o "BASE32:dígitos:período:algoritmo" si la URI otpauth:// pedía otra cosa.
 */

export const TOTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

export interface TotpParams {
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

const BASE32_RE = /^[A-Z2-7]+$/;

function cleanBase32(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

/** Base32 válido y de al menos 80 bits (16 caracteres), como piden los sitios. */
function validBase32(s: string): boolean {
  return s.length >= 16 && s.length <= 128 && BASE32_RE.test(s);
}

/**
 * Secreto pegado por la persona (base32 con espacios o la URI otpauth:// del
 * QR) → formato guardado, o null si no es válido.
 */
export function normalizeTotpSecret(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^otpauth:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.host.toLowerCase() !== 'totp') return null;
    const secret = cleanBase32(url.searchParams.get('secret') ?? '');
    if (!validBase32(secret)) return null;
    const digits = Number(url.searchParams.get('digits') ?? 6);
    const period = Number(url.searchParams.get('period') ?? 30);
    const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '') as TotpAlgorithm;
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) return null;
    if (!Number.isInteger(period) || period < 15 || period > 300) return null;
    if (!TOTP_ALGORITHMS.includes(algorithm)) return null;
    return digits === 6 && period === 30 && algorithm === 'SHA1' ? secret : `${secret}:${digits}:${period}:${algorithm}`;
  }
  const secret = cleanBase32(value);
  return validBase32(secret) ? secret : null;
}

/** Formato guardado → parámetros (null si está corrupto). */
export function parseTotpSecret(stored: string): TotpParams | null {
  const [secret, d, p, a] = stored.split(':');
  if (!secret || !validBase32(secret)) return null;
  const digits = d ? Number(d) : 6;
  const period = p ? Number(p) : 30;
  const algorithm = (a || 'SHA1') as TotpAlgorithm;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8 || !Number.isInteger(period) || period < 15 || period > 300) return null;
  if (!TOTP_ALGORITHMS.includes(algorithm)) return null;
  return { secret, digits, period, algorithm };
}
