/**
 * Última barrera antes de que una respuesta llegue al modelo: quita valores de
 * campos secretos, cualquier string con forma de credencial y las URLs nuestras
 * que funcionan como credencial. No reemplaza que las rutas no devuelvan
 * secretos, lo refuerza.
 *
 * Regla: una conexión no recibe nada que le sirva después de cortarla, ni algo
 * que le permita escribir a una conexión de solo lectura. Lo que no es de eso
 * pasa tal cual: un link de Google Docs, una tasa de aprobación, un nombre.
 */
import { issuerUrl } from '../oauth/store';

/** Marca propia: en un texto común no aparece, y volver a mandarla se puede detectar (invoke.ts). */
export const REDACTED = '[redacted by zerosoft]';

// ---------- Nombres de campo, por palabras enteras ----------

function words(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Públicos por definición, o que no contienen una credencial aunque se llamen parecido. */
const SAFE_NAMES = new Set(['verify_token', 'publishable_key', 'page_token', 'next_page_token', 'prev_page_token', 'continuation_token']);

const SECRET_WORDS = new Set([
  'token', 'tokens', 'secret', 'secrets', 'password', 'passwords', 'passwd', 'passphrase', 'pass', 'credential', 'credentials',
  'cookie', 'cookies', 'authorization', 'bearer', 'ciphertext', 'encrypted', 'hmac', 'dsn', 'otp', 'signature', 'verifier', 'apikey', 'auth',
]);
const SECRET_PAIRS = new Set([
  'api key', 'private key', 'signing key', 'client key', 'auth key', 'write key', 'stripe key', 'encryption key', 'secret key', 'access key',
  'webhook url', 'hook url', 'invite url',
]);

/** Después del nombre secreto no cambian lo que es: token_hash, secret_value, password_enc. */
const SAME_TAIL = new Set(['hash', 'value', 'enc', 'raw', 'plain']);
/** Hablan del secreto sin serlo, si son cortos: api_key_hint. Uno largo es la key entera. */
const HINT_TAIL = new Set(['hint', 'prefix', 'last4', 'masked', 'preview']);
const MAX_HINT_CHARS = 12;

function endsSecret(w: string[]): boolean {
  const last = w[w.length - 1];
  if (!last) return false;
  if (SECRET_WORDS.has(last)) return true;
  return w.length > 1 && SECRET_PAIRS.has(`${w[w.length - 2]} ${last}`);
}

/**
 * ¿El nombre termina en un secreto? authorization_status, pass_rate,
 * cookie_consent, credentialId, secretary, has_secret y secret_set no.
 */
export function isSecretKey(key: string): boolean {
  const w = words(key);
  if (SAFE_NAMES.has(w.join('_'))) return false;
  if (w[0] === 'has' || w[0] === 'is') return false;
  const last = w[w.length - 1];
  if (last === undefined) return false;
  if (SAME_TAIL.has(last) || HINT_TAIL.has(last)) return endsSecret(w.slice(0, -1));
  return endsSecret(w);
}

const isHintKey = (key: string) => HINT_TAIL.has(words(key).at(-1) ?? '');
/** Contador de uso del modelo: input_tokens, tokens. */
const isTokenCount = (key: string) => words(key).at(-1) === 'tokens';

// ---------- Valores con forma de credencial ----------

const NOT_INSIDE_A_WORD = '(?<![\\w-])';
const SECRET_VALUE: RegExp[] = [
  new RegExp(`${NOT_INSIDE_A_WORD}zs(?:at|rt|ac|dc|a|s|id)?_[A-Za-z0-9_-]{16,}`, 'g'),
  new RegExp(`${NOT_INSIDE_A_WORD}fh_[A-Za-z0-9_-]{8,}`, 'g'),
  new RegExp(`${NOT_INSIDE_A_WORD}zth_[A-Za-z0-9_-]{8,}`, 'g'),
  // sk- solo si es la palabra entera y lleva dígitos: "sk-learn-pipeline" o "task-sk-x" no son keys.
  new RegExp(`${NOT_INSIDE_A_WORD}sk[-_](?:live|test|proj|ant)[-_][A-Za-z0-9_-]{16,}`, 'g'),
  new RegExp(`${NOT_INSIDE_A_WORD}sk-(?=[A-Za-z_-]*\\d)[A-Za-z0-9_-]{16,}`, 'g'),
  new RegExp(`${NOT_INSIDE_A_WORD}rk_(?:live|test)_[A-Za-z0-9]{16,}`, 'g'),
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

// ---------- URLs que son una credencial ----------

// Sin corchetes ni paréntesis: un link en Markdown queda balanceado.
const URL_END = `[^\\s"'<>()\\[\\]]*`;
const URL_CHAR = `[^\\s"'<>()\\[\\]]`;
/** Páginas con [token]: quien tiene el link firma, aprueba o entra sin sesión. */
const TOKEN_PAGES = 'm|sign|d|q|b/e|b|n|invite|view|watch|stats|flow/approve|flow/form|book/manage|app/docs/invite';
const TOKEN_APIS = 'flow/(?:hooks|resume|approvals)|talk/hooks|groups/webhook|boards/guest|crm/(?:d|v|t/[cuo])|calendar/poll-votes|books/public|sign/public|crm/quotes/public';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ownHosts(): string {
  const hosts = new Set<string>();
  for (const raw of [issuerUrl(), process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXTAUTH_URL]) {
    try {
      if (raw) hosts.add(new URL(raw).host);
    } catch {
      /* mal configurada: no aporta un host */
    }
  }
  return [...hosts].map(escapeRe).join('|');
}

/**
 * ¿Es un token o un texto? Los tokens salen de randomBytes(n).toString('base64url'
 * o 'hex'), nanoid y randomUUID: largos, sin palabras. quarterly-report-2026-final
 * y how-to-onboard-new-people son slugs, y week no es nada.
 */
export function looksLikeToken(value: string): boolean {
  if (value.length < 16) return false;
  if (/^[0-9a-f]{16,}$/i.test(value) || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return true;
  const parts = value.split(/[-_]+/).filter(Boolean);
  const isWordy = parts.every((p) => /^[A-Z]?[a-z]+\d{0,4}$/.test(p) || /^\d{1,8}$/.test(p));
  return !isWordy;
}

interface CapabilityPatterns {
  hosts: string;
  always: RegExp[];
  /** El grupo 1 es el valor que tiene que parecer un token. */
  ifToken: RegExp[];
}

let cached: CapabilityPatterns | null = null;

/** Solo sobre nuestro dominio (absoluto o relativo) y los hooks de terceros conocidos. Otro host pasa. */
function capabilityUrls(): CapabilityPatterns {
  const hosts = ownHosts();
  if (cached?.hosts === hosts) return cached;
  const own = `(?:https?://(?:${hosts}))`;
  const start = `(?:${own}|(?<![\\w/.:-]))`;
  cached = {
    hosts,
    ifToken: [
      new RegExp(`${start}/(?:(?:en|es|pt)/)?(?:${TOKEN_PAGES})/([A-Za-z0-9_-]{16,})${URL_END}`, 'g'),
      new RegExp(`${start}/[^\\s"'<>()\\[\\]?]*\\?(?:${URL_CHAR}*&)?(?:t|share|token)=([A-Za-z0-9_-]+)${URL_END}`, 'g'),
    ],
    always: [
      new RegExp(`${start}/api/(?:${TOKEN_APIS})/${URL_CHAR}+`, 'g'),
      /https?:\/\/hooks\.slack\.com\/[^\s"'<>()[\]]+/g,
      /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>()[\]]+/g,
      /https?:\/\/[^\s"'<>:/@]+:[^\s"'<>@/]+@[^\s"'<>()[\]]+/g,
    ],
  };
  return cached;
}

export function scrubText(text: string): string {
  let out = text;
  const urls = capabilityUrls();
  for (const re of [...SECRET_VALUE, ...urls.always]) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  for (const re of urls.ifToken) {
    re.lastIndex = 0;
    out = out.replace(re, (match, value: string) => (looksLikeToken(value) ? REDACTED : match));
  }
  return out;
}

/** Texto que no se pudo leer como JSON (JSON cortado, HTML): pares clave y valor con nombre secreto. */
export function scrubLooseText(text: string): string {
  const pairs = /(["']?)([A-Za-z0-9_-]{2,64})\1(\s*[:=]\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\s,;&"'}\]]+)/g;
  return scrubText(text).replace(pairs, (match, q: string, key: string, sep: string, value: string) => {
    if (!isSecretKey(key) || /^(true|false|null)$/.test(value)) return match;
    if (isTokenCount(key) && /^\d+$/.test(value)) return match;
    return `${q}${key}${q}${sep}"${REDACTED}"`;
  });
}

// ---------- Por operación ----------

interface PathRule {
  path: RegExp;
  /** Públicos en esta ruta aunque el nombre diga otra cosa. */
  allow?: string[];
  /** Una lista: pasa, y cada elemento se revisa por sus campos. */
  list?: string[];
  /** Secretos en esta ruta aunque el nombre no lo diga. */
  hide?: string[];
}

const PATH_RULES: PathRule[] = [
  { path: /^\/api\/links\/publishable-key$/, allow: ['key', 'publishableKey'] },
  { path: /^\/api\/calendar\/polls(\/|$)/, allow: ['token'] },
  { path: /^\/api\/(v1\/)?crm\/forms(\/|$)/, allow: ['token'] },
  { path: /^\/api\/flow\/credentials(\/|$)/, list: ['credentials', 'credential'] },
  { path: /^\/api\/agents\/\[id\]\/secrets(\/|$)/, list: ['secrets'] },
  { path: /^\/api\/notes\/email-address$/, hide: ['address'] },
  { path: /^\/api\/links\/shares(\/|$)/, hide: ['path'] },
];

interface ScrubOptions {
  allow: Set<string>;
  list: Set<string>;
  hide: Set<string>;
}

const NO_RULES: ScrubOptions = { allow: new Set(), list: new Set(), hide: new Set() };

function underSecretKey(key: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (isTokenCount(key)) {
    if (typeof value === 'number') return value;
    // Uso del modelo: { input: 10, output: 20 }.
    if (typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'number')) return value;
  }
  if (value === '') return value;
  if (typeof value === 'string' && isHintKey(key) && value.length <= MAX_HINT_CHARS) return value;
  // Un número, un objeto o una lista bajo un nombre secreto: se tapa entero.
  return REDACTED;
}

function walk<T>(value: T, opts: ScrubOptions, depth: number): T {
  if (depth > 40) return REDACTED as unknown as T;
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => walk(v, opts, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (opts.allow.has(k)) out[k] = v;
      else if (opts.list.has(k)) out[k] = walk(v, opts, depth + 1);
      else if (opts.hide.has(k)) out[k] = v === null || v === '' ? v : REDACTED;
      else out[k] = isSecretKey(k) ? underSecretKey(k, v) : walk(v, opts, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

export function scrubSecrets<T>(value: T, depth = 0): T {
  return walk(value, NO_RULES, depth);
}

/** La respuesta de una ruta del catálogo: lo general más lo propio de esa ruta. */
export function scrubForPath<T>(path: string, value: T): T {
  const rules = PATH_RULES.filter((r) => r.path.test(path));
  if (!rules.length) return walk(value, NO_RULES, 0);
  return walk(value, { allow: new Set(rules.flatMap((r) => r.allow ?? [])), list: new Set(rules.flatMap((r) => r.list ?? [])), hide: new Set(rules.flatMap((r) => r.hide ?? [])) }, 0);
}
