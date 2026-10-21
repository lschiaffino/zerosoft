/**
 * CRM — llamadas y toques por WhatsApp desde los links de teléfono (puro: lo
 * usan server y client).
 *
 * Al tocar un teléfono (tel:) o su atajo de WhatsApp se abre la app y la UI
 * ofrece registrar el toque como actividad `call` con su resultado. El canal
 * va en crm_activities.channel ('' = teléfono, 'whatsapp').
 *
 * Resultados: el workspace los configura en Ajustes, una lista para llamadas
 * y otra para WhatsApp (crm_settings.call_outcomes, JSON: {call, whatsapp};
 * las bases viejas guardaban solo la lista de llamadas como array). Sin
 * configurar se usan DEFAULT_CALL_OUTCOMES / DEFAULT_WHATSAPP_OUTCOMES, que
 * son claves y se traducen en la UI; los configurados son texto libre y se
 * muestran tal cual.
 */

export const CALL_CHANNELS = ['', 'whatsapp'] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];

export const DEFAULT_CALL_OUTCOMES = ['connected', 'left_voicemail', 'no_answer', 'busy', 'wrong_number'] as const;
export type DefaultCallOutcome = (typeof DEFAULT_CALL_OUTCOMES)[number];

/** Un mensaje no se "atiende" ni deja buzón: WhatsApp tiene sus propios resultados. */
export const DEFAULT_WHATSAPP_OUTCOMES = ['replied', 'read_no_reply', 'delivered', 'not_on_whatsapp'] as const;
export type DefaultWhatsappOutcome = (typeof DEFAULT_WHATSAPP_OUTCOMES)[number];

export type OutcomeKind = 'call' | 'whatsapp';

export const MAX_CALL_OUTCOMES = 20;
const MAX_OUTCOME_LEN = 60;

export function defaultOutcomes(kind: OutcomeKind): string[] {
  return kind === 'whatsapp' ? [...DEFAULT_WHATSAPP_OUTCOMES] : [...DEFAULT_CALL_OUTCOMES];
}

/** Clave de los de siempre (de llamada o de WhatsApp): la UI la traduce. */
export function isDefaultOutcome(v: string): v is DefaultCallOutcome | DefaultWhatsappOutcome {
  return (DEFAULT_CALL_OUTCOMES as readonly string[]).includes(v) || (DEFAULT_WHATSAPP_OUTCOMES as readonly string[]).includes(v);
}

/** Lista limpia: sin vacíos ni repetidos (sin importar mayúsculas), recortada. */
export function normalizeCallOutcomes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_OUTCOME_LEN);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= MAX_CALL_OUTCOMES) break;
  }
  return out;
}

/** Lo que configuró el workspace por canal (lista vacía = los de siempre). */
export interface OutcomeConfig {
  call: string[];
  whatsapp: string[];
}

/** JSON guardado → listas propias por canal. Acepta el formato viejo (array = llamadas). */
export function parseOutcomeConfig(json: string | null | undefined): OutcomeConfig {
  if (!json) return { call: [], whatsapp: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { call: [], whatsapp: [] };
  }
  if (Array.isArray(raw)) return { call: normalizeCallOutcomes(raw), whatsapp: [] };
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { call: normalizeCallOutcomes(obj.call), whatsapp: normalizeCallOutcomes(obj.whatsapp) };
}

/** Listas por canal → JSON a guardar; null si las dos son las de siempre. */
export function serializeOutcomeConfig(config: OutcomeConfig): string | null {
  const call = normalizeCallOutcomes(config.call);
  const whatsapp = normalizeCallOutcomes(config.whatsapp);
  if (!call.length && !whatsapp.length) return null;
  return JSON.stringify({ ...(call.length ? { call } : {}), ...(whatsapp.length ? { whatsapp } : {}) });
}

/** JSON guardado → lista del canal; null/roto/vacío = los de siempre. */
export function parseCallOutcomes(json: string | null | undefined, kind: OutcomeKind = 'call'): string[] {
  const list = parseOutcomeConfig(json)[kind];
  return list.length ? list : defaultOutcomes(kind);
}

/** Solo dígitos (con el + inicial si lo había). */
export function phoneDigits(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/** href tel: del teléfono; null si no tiene dígitos suficientes. */
export function telHref(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d.replace('+', '').length >= 5 ? `tel:${d}` : null;
}

/**
 * Link de WhatsApp (wa.me pide el número internacional sin + ni ceros). Un
 * número local sin código de país también abre, pero WhatsApp puede no
 * encontrarlo: la UI lo deja igual porque el usuario sabe a quién escribe.
 */
export function whatsappHref(phone: string | null | undefined, text?: string): string | null {
  const d = phoneDigits(phone).replace(/^\+/, '').replace(/^00/, '');
  if (d.length < 7 || d.length > 15) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
