/**
 * Lo que devuelve una herramienta pasa por acá antes de llegar al modelo, a
 * la UI o al registro: se sacan las claves que suelen guardar secretos
 * (tokens, contraseñas, keys, firmas) y se recortan textos y listas largas.
 */

const SECRET_KEY = /(token|secret|password|passwd|api_?key|apikey|credential|signing|cookie|access_key|^auth$|^auth_|authorization|^otp|private_key|webhook_key|smtp_pass)/i;
/** Valores con forma de secreto aunque la clave sea inocente (Bearer, sk-…, JWT). */
const SECRET_VALUE = /^(Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|xox[abp]-\S+|ghp_\S+|re_[A-Za-z0-9]{16,})$/;

export const REDACTED = '[hidden]';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value.trim())) return REDACTED;
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
