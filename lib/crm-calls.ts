/**
 * CRM — llamadas y toques por WhatsApp desde los links de teléfono (puro: lo
 * usan server y client).
 *
 * Al tocar un teléfono (tel:) o su atajo de WhatsApp se abre la app y la UI
 * ofrece registrar el toque como actividad `call` con su resultado. El canal
 * va en crm_activities.channel ('' = teléfono, 'whatsapp').
 *
 * Resultados: el workspace los configura en Ajustes (crm_settings.call_outcomes,
 * JSON). Sin configurar se usan DEFAULT_CALL_OUTCOMES, que son claves y se
 * traducen en la UI; los configurados son texto libre y se muestran tal cual.
 */

export const CALL_CHANNELS = ['', 'whatsapp'] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];

export const DEFAULT_CALL_OUTCOMES = ['connected', 'left_voicemail', 'no_answer', 'busy', 'wrong_number'] as const;
export type DefaultCallOutcome = (typeof DEFAULT_CALL_OUTCOMES)[number];

export const MAX_CALL_OUTCOMES = 20;
const MAX_OUTCOME_LEN = 60;

export function isDefaultOutcome(v: string): v is DefaultCallOutcome {
  return (DEFAULT_CALL_OUTCOMES as readonly string[]).includes(v);
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

/** JSON guardado → lista; null/roto/vacío = los de siempre. */
export function parseCallOutcomes(json: string | null | undefined): string[] {
  if (!json) return [...DEFAULT_CALL_OUTCOMES];
  try {
    const list = normalizeCallOutcomes(JSON.parse(json));
    return list.length ? list : [...DEFAULT_CALL_OUTCOMES];
  } catch {
    return [...DEFAULT_CALL_OUTCOMES];
  }
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
