/**
 * Última barrera antes de que una respuesta llegue al modelo: quita valores de
 * campos secretos, cualquier string con forma de credencial y las URLs que
 * funcionan como credencial, venga de donde venga. No reemplaza que las rutas
 * no devuelvan secretos, lo refuerza.
 *
 * Regla: una conexión no recibe nada que le sirva después de cortarla, ni algo
 * que le permita escribir a una conexión de solo lectura.
 */
export const REDACTED = '[redacted]';

// Nombres de campo: *token, *secret, password, api key, private key, credentials, *_enc, cifrados.
const SECRET_KEY =
  /(token|secret|password|passwd|passphrase|api_?key|apikey|private_?key|signing_?key|client_?key|auth_?key|write_?key|credentials?|cookie|authorization|bearer|webhook_?url|hook_?url|invite_?url|_enc$|encrypted|ciphertext|hmac|dsn|(^|_)otp(_|$)|(^|_)pass(_|$)|smtp_?pass|^auth$|_auth$|verifier)/i;

// Públicos por definición, o que no contienen una credencial aunque se llamen parecido.
const SAFE_KEY = /^(verify_?token|publishable_?key|page_?token|next_?page_?token|prev_?page_?token|continuation_?token)$/i;

// Contadores de uso del modelo: números, nunca credenciales.
const COUNT_KEY = /^(tokens?|tokens?_?used|tokens?_?count|max_?(output_?)?tokens?|input_?tokens?|output_?tokens?|total_?tokens?|prompt_?tokens?|completion_?tokens?)$/i;

// Sufijos que dicen algo sobre el secreto sin serlo. Con el valor corto: uno largo es la key entera.
const HINT_KEY = /(_|^)?(hint|prefix|last_?4|masked|preview)$/i;
const MAX_HINT_CHARS = 12;

// Banderas y fechas: "está configurado", "se rotó tal día".
const FLAG_KEY = /^(has|is)_?\w+$|\w+_?(set|configured|present|count|at)$/i;

/** Valores con forma de credencial conocida, en cualquier campo o en medio de un texto. */
const SECRET_VALUE: RegExp[] = [
  /\bzs(?:at|rt|ac|dc|a|s|id)?_[A-Za-z0-9_-]{16,}/g,
  /\bfh_[A-Za-z0-9_-]{8,}/g,
  /\bzth_[A-Za-z0-9_-]{8,}/g,
  /\bsk[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}/g,
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

/**
 * URLs que son una credencial: quien la tiene escribe o entra sin sesión.
 * Son las páginas y rutas con [token] de la app, y los hooks de terceros.
 */
const CAPABILITY_URL: RegExp[] = [
  /https?:\/\/[^\s"'<>]*\/(?:(?:en|es|pt)\/)?(?:m|sign|d|q|b\/e|b|n|invite|view|watch|stats|flow\/approve|flow\/form|book\/manage|book\/poll|app\/docs\/invite)\/[A-Za-z0-9_-]{16,}[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*\/api\/(?:flow\/(?:hooks|resume|approvals)|talk\/hooks|groups\/webhook|boards\/guest|crm\/(?:d|v|t\/[cuo])|calendar\/poll-votes|books\/public|sign\/public|crm\/quotes\/public)\/[^\s"'<>]+/g,
  /https?:\/\/hooks\.slack\.com\/[^\s"'<>]+/g,
  /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>]+/g,
  /https?:\/\/[^\s"'<>:]+:[^\s"'<>@]+@[^\s"'<>]+/g,
];

export function isSecretKey(key: string): boolean {
  // Un contador de uso con forma de número se resuelve abajo: `tokens` como texto u objeto se tapa igual.
  if (SAFE_KEY.test(key)) return false;
  return SECRET_KEY.test(key);
}

export function scrubText(text: string): string {
  let out = text;
  for (const re of [...SECRET_VALUE, ...CAPABILITY_URL]) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** Texto que no se pudo leer como JSON (CSV, JSON cortado, HTML): pares clave y valor con nombre secreto. */
export function scrubLooseText(text: string): string {
  const pairs = /(["']?)([A-Za-z0-9_-]{2,64})\1(\s*[:=]\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\s,;&"'}\]]+)/g;
  return scrubText(text).replace(pairs, (match, q: string, key: string, sep: string, value: string) => {
    if (!isSecretKey(key) || COUNT_KEY.test(key)) return match;
    if (FLAG_KEY.test(key) || /^(true|false|null)$/.test(value)) return match;
    return `${q}${key}${q}${sep}"${REDACTED}"`;
  });
}

function scrubUnderSecretKey(key: string, value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || value === undefined) return value;
  if (typeof value === 'number' && COUNT_KEY.test(key)) return value;
  if (typeof value === 'string') {
    if (value === '') return value;
    if (HINT_KEY.test(key) && value.length <= MAX_HINT_CHARS) return value;
    if (FLAG_KEY.test(key)) return scrubText(value);
    return REDACTED;
  }
  if (typeof value === 'number') return FLAG_KEY.test(key) ? value : REDACTED;
  // Un objeto o una lista bajo un nombre secreto: se tapa entero.
  return REDACTED;
}

export function scrubSecrets<T>(value: T, depth = 0): T {
  if (depth > 40) return REDACTED as unknown as T;
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? scrubUnderSecretKey(k, v) : scrubSecrets(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
