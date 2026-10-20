/**
 * Chat — contexto del visitante que manda el widget con cada mensaje: la
 * página desde la que escribe, de dónde llegó, el idioma del navegador y el
 * navegador (del User-Agent del request). Se guarda en chat_visitors.metadata
 * (clave "page") junto a las respuestas del formulario pre-chat ("form") y lo
 * muestra el panel del visitante en el inbox. Todo es declarado por el
 * navegador: sirve de contexto, no de identidad. Sin acceso a la base (lo
 * usa también el panel del inbox); guardar es saveVisitorContext de chat-data.
 */

export interface VisitorPageContext {
  url: string | null;
  title: string | null;
  referrer: string | null;
  language: string | null;
  browser: string | null;
  /** Cuándo se vio esta página por última vez (ISO). */
  seenAt: string;
}

const URL_MAX = 1000;

/** Solo URLs http(s) completas; nada de javascript:, data:, etc. */
export function cleanHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().slice(0, URL_MAX);
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return v || null;
}

/** "es-AR", "pt", "en-US": etiqueta BCP 47 corta; cualquier otra cosa se descarta. */
export function cleanLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, 35);
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? v : null;
}

const BROWSERS: Array<[string, RegExp]> = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /(?:OPR|Opera)\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[\d.]* .*Safari\//],
];

const SYSTEMS: Array<[string, RegExp]> = [
  ['iOS', /iPhone|iPad|iPod/],
  ['Android', /Android/],
  ['Windows', /Windows/],
  ['macOS', /Mac OS X|Macintosh/],
  ['ChromeOS', /CrOS/],
  ['Linux', /Linux/],
];

/** "Chrome 120 · macOS" a partir del User-Agent (null si no se reconoce nada). */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  let browser: string | null = null;
  for (const [name, re] of BROWSERS) {
    const m = ua.match(re);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const system = SYSTEMS.find(([, re]) => re.test(ua))?.[0] ?? null;
  const parts = [browser, system].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Contexto de la página validado. raw es el objeto `context` que manda el
 * widget ({ url, title, referrer, language }); el navegador sale del
 * User-Agent del request. null si no hay nada útil.
 */
export function visitorPageContext(raw: unknown, userAgent: string | null, now = new Date()): VisitorPageContext | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ctx: VisitorPageContext = {
    url: cleanHttpUrl(o.url),
    title: cleanText(o.title, 200),
    referrer: cleanHttpUrl(o.referrer),
    language: cleanLanguage(o.language),
    browser: describeUserAgent(userAgent),
    seenAt: now.toISOString(),
  };
  return ctx.url || ctx.referrer || ctx.language || ctx.browser ? ctx : null;
}

/** metadata del visitante como objeto (inválida o ausente = {}). */
export function parseVisitorMetadata(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Contexto guardado (para el panel del inbox y el email de respuestas sin leer). */
export function readVisitorPage(metadata: string | null | undefined): VisitorPageContext | null {
  const page = parseVisitorMetadata(metadata).page;
  if (!page || typeof page !== 'object') return null;
  const p = page as Record<string, unknown>;
  return {
    url: cleanHttpUrl(p.url),
    title: cleanText(p.title, 200),
    referrer: cleanHttpUrl(p.referrer),
    language: cleanLanguage(p.language),
    browser: cleanText(p.browser, 80),
    seenAt: typeof p.seenAt === 'string' ? p.seenAt : '',
  };
}

/** Respuestas del formulario pre-chat guardadas ({ etiqueta: valor }). */
export function readVisitorForm(metadata: string | null | undefined): Array<{ label: string; value: string }> {
  const form = parseVisitorMetadata(metadata).form;
  if (!form || typeof form !== 'object' || Array.isArray(form)) return [];
  return Object.entries(form as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '')
    .map(([label, value]) => ({ label, value }));
}

export interface VisitorContextPatch {
  form?: Record<string, string>;
  page?: VisitorPageContext | null;
}

/**
 * Metadata nueva con el formulario y/o la página, o null si no cambia nada.
 * La página se reemplaza (es la última); el referrer de la primera visita se
 * conserva si la nueva no trae (navegar dentro del sitio no lo manda). La
 * misma página que la guardada no se reescribe en cada mensaje.
 */
export function mergeVisitorMetadata(
  raw: string | null | undefined,
  patch: VisitorContextPatch,
): Record<string, unknown> | null {
  const previous = readVisitorPage(raw);
  const page = patch.page ? { ...patch.page, referrer: patch.page.referrer ?? previous?.referrer ?? null } : null;
  const samePage =
    !!page && !!previous && (['url', 'title', 'referrer', 'language', 'browser'] as const).every((k) => page[k] === previous[k]);
  if (!patch.form && (!page || samePage)) return null;
  const metadata = parseVisitorMetadata(raw);
  if (patch.form) metadata.form = patch.form;
  if (page && !samePage) metadata.page = page;
  return metadata;
}
