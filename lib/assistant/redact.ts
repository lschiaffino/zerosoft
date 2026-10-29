/**
 * Lo que devuelve una herramienta pasa por acá antes de llegar al modelo, a
 * la UI o al registro: se sacan las claves que suelen guardar secretos
 * (tokens, contraseñas, keys, firmas), los valores con forma de secreto
 * aunque estén dentro de un texto ("my key is sk-…", "Authorization: Bearer
 * …") y se recortan textos y listas largas.
 */

const SECRET_KEY =
  /(token|secret|password|passwd|^pwd$|api_?key|apikey|credential|signing|signature|cookie|access_key|^auth$|^auth_|authorization|^otp|private_?key|webhook_key|smtp_pass|^key$|invite_?url)/i;

/** Secretos conocidos dentro de cualquier texto. */
const SECRET_IN_TEXT: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/g,
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bzs_[A-Za-z0-9_-]{12,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}/g,
  /\bre_[A-Za-z0-9_]{16,}/g,
  /\bwhsec_[A-Za-z0-9_-]{8,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
];

export const REDACTED = '[hidden]';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** Reemplaza los secretos que aparezcan dentro de un texto. */
export function redactText(value: string): string {
  let out = value;
  for (const re of SECRET_IN_TEXT) out = out.replace(re, REDACTED);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const clean = redactText(value);
    return clean.length > 2000 ? `${clean.slice(0, 2000)}…` : clean;
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

/** URL sin secretos: el host y el path enmascarado (las URLs de webhooks suelen ser el secreto). */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname && u.pathname !== '/' ? '/…' : ''}`;
  } catch {
    return REDACTED;
  }
}
