/**
 * Última barrera antes de que una respuesta llegue al modelo: quita valores de
 * campos secretos y cualquier string con forma de credencial, venga de donde
 * venga. No reemplaza que las rutas no devuelvan secretos, lo refuerza.
 */
const REDACTED = '[redacted]';

// Nombres de campo: *token, *secret, password, api key, private key, credentials, *_enc, cifrados.
const SECRET_KEY =
  /(token|secret|password|passwd|passphrase|api_?key|apikey|private_?key|signing_?key|client_?key|auth_?key|credentials?|cookie|authorization|bearer|webhook_?url|_enc$|encrypted|ciphertext|(^|_)otp(_|$)|verifier)/i;

// Campos con esas palabras que son públicos o no son credenciales.
const SAFE_KEY =
  /^(verify_?token|share_?token|public_?token|publishable_?key|page_?token|next_?page_?token|prev_?page_?token|continuation_?token|max_?tokens?|input_?tokens?|output_?tokens?|total_?tokens?|prompt_?tokens?|completion_?tokens?|tokens?_?used|tokens?|has_?\w+|is_?\w+|\w+_?(set|configured|present|masked|hint|preview|prefix|count|last4|at))$/i;

/** Valores con forma de credencial conocida, en cualquier campo o en medio de un texto. */
const SECRET_VALUE: RegExp[] = [
  /\bzs(?:at|rt|ac|dc|a)?_[A-Za-z0-9_-]{16,}/g,
  /\bsk[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\b(?:rk|pk)_(?:live)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{16,}/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bEAA[A-Za-z0-9]{40,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function isSecretKey(key: string): boolean {
  if (SAFE_KEY.test(key)) return false;
  return SECRET_KEY.test(key);
}

export function scrubText(text: string): string {
  let out = text;
  for (const re of SECRET_VALUE) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

export function scrubSecrets<T>(value: T, depth = 0): T {
  if (depth > 40) return value;
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Solo se tapa un valor con contenido: booleans y null dicen "está configurado", no el secreto.
      if (isSecretKey(k) && typeof v === 'string' && v !== '') out[k] = REDACTED;
      else out[k] = scrubSecrets(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
