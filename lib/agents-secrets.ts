/**
 * Agents — que ningún secreto (headers de http_request, token de un servidor
 * MCP) llegue al modelo, al registro de herramientas, a las aprobaciones, al
 * export ni a la UI, aunque el servicio lo devuelva en un eco o un error.
 *
 * De cada valor se tapan también sus partes: lo que sigue al esquema
 * ("Bearer abc" → "abc"), el usuario y la clave de un "Basic" en base64 y la
 * versión codificada para URL. La redacción recorre objetos y arrays (solo los
 * strings), así un JSON sigue siendo JSON. Puro (sin DB).
 */

const SCHEMES = new Set(['bearer', 'basic', 'token', 'apikey', 'api-key', 'digest', 'bot']);
const MIN_PART = 6;

/** El valor y sus partes que, solas, también sirven como credencial. */
export function secretVariants(value: string): string[] {
  const out = new Set<string>();
  const add = (v: string, min = MIN_PART) => {
    const t = v.trim();
    if (t.length >= min && !SCHEMES.has(t.toLowerCase())) out.add(t);
  };
  if (!value) return [];
  add(value, 4);
  const parts = value.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    add(p);
    // "Basic dXNlcjpwYXNz": usuario y clave en claro.
    if (/^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(p)) {
      try {
        const decoded = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(decoded) && decoded.includes(':')) {
          add(decoded, 4);
          for (const d of decoded.split(':')) add(d);
        }
      } catch {
        /* no era base64 */
      }
    }
  }
  // Partes de un token con separadores ("sk_live_abc123", "id.secret"): el tramo largo también.
  for (const p of parts) for (const piece of p.split(/[._:-]/)) if (piece.length >= 10) add(piece);
  for (const v of [...out]) {
    const enc = encodeURIComponent(v);
    if (enc !== v) out.add(enc);
    // El valor en base64 (con y sin relleno): algunos servicios lo devuelven así.
    if (v.length >= 6) {
      const b64 = Buffer.from(v, 'utf8').toString('base64');
      out.add(b64);
      out.add(b64.replace(/=+$/, ''));
    }
  }
  // Los más largos primero: "Bearer abc…" antes que "abc…".
  return [...out].sort((a, b) => b.length - a.length);
}

export function allSecretVariants(values: string[]): string[] {
  return [...new Set(values.flatMap(secretVariants))].sort((a, b) => b.length - a.length);
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tapa cada secreto sin importar mayúsculas (un eco puede cambiar el caso). */
export function redactText(text: string, secrets: string[]): string {
  let out = text;
  const lower = text.toLowerCase();
  for (const v of secrets) {
    if (!v || !lower.includes(v.toLowerCase())) continue;
    out = out.replace(new RegExp(escapeRe(v), 'gi'), '[redacted]');
  }
  return out;
}

/** Copia del valor con los secretos tapados en cada string (y en las claves). */
export function redactDeep<T>(value: T, secrets: string[], depth = 0): T {
  if (secrets.length === 0 || depth > 40) return value;
  if (typeof value === 'string') return redactText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[redactText(k, secrets)] = redactDeep(v, secrets, depth + 1);
    return out as T;
  }
  return value;
}
