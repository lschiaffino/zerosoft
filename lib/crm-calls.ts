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

/** Códigos de país de 2 dígitos (el resto, salvo +1 y +7, tiene 3). */
const TWO_DIGIT_CC = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '),
);

/** Códigos de área argentinos de 4 dígitos más comunes (el resto tiene 2 o 3). */
const AR_AREA_4 = new Set(
  '2202 2221 2223 2224 2225 2226 2227 2229 2241 2242 2243 2244 2245 2246 2252 2254 2255 2257 2261 2262 2264 2265 2266 2267 2268 2271 2272 2273 2274 2281 2283 2284 2285 2286 2291 2292 2296 2297 2302 2314 2316 2317 2320 2323 2324 2325 2326 2331 2333 2334 2335 2336 2337 2338 2342 2343 2344 2345 2346 2352 2353 2354 2355 2356 2357 2358 2392 2393 2394 2395 2396 2473 2474 2475 2477 2478 2622 2624 2625 2626 2646 2647 2648 2651 2655 2656 2657 2658 2901 2902 2903 2920 2921 2922 2923 2924 2925 2926 2927 2928 2929 2931 2932 2933 2934 2935 2936 2940 2942 2944 2945 2946 2948 2952 2953 2954 2962 2963 2964 2966 2972 2982 2983 3327 3329 3382 3385 3387 3388 3400 3401 3402 3404 3405 3406 3407 3408 3409 3435 3436 3437 3438 3442 3444 3445 3446 3447 3454 3455 3456 3458 3460 3462 3463 3464 3465 3466 3467 3468 3469 3471 3472 3476 3482 3483 3487 3489 3491 3492 3493 3496 3497 3498 3521 3522 3524 3525 3532 3533 3537 3541 3542 3543 3544 3546 3547 3548 3549 3562 3563 3564 3571 3572 3573 3574 3575 3576 3582 3583 3584 3585 3711 3715 3716 3718 3721 3725 3731 3734 3735 3741 3743 3751 3754 3755 3756 3757 3758 3772 3773 3774 3775 3777 3781 3782 3786 3821 3825 3826 3827 3832 3835 3837 3838 3841 3843 3844 3845 3846 3854 3855 3856 3857 3858 3861 3862 3863 3865 3867 3868 3869 3873 3876 3877 3878 3885 3886 3887 3888 3891 3892 3894'.split(' '),
);

/** Argentina sin el 54: celulares con 9, área de 2 a 4 dígitos y abonado partido con guion. */
function formatArgentina(d: string): string {
  const mobile = d.startsWith('9');
  const n = mobile ? d.slice(1) : d;
  if (n.length !== 10) return '';
  const areaLen = n.startsWith('11') ? 2 : AR_AREA_4.has(n.slice(0, 4)) ? 4 : 3;
  const area = n.slice(0, areaLen);
  const sub = n.slice(areaLen);
  return `+54 ${mobile ? '9 ' : ''}${area} ${sub.slice(0, -4)}-${sub.slice(-4)}`;
}

/**
 * Teléfono para leer, en todos lados la misma función. Lo internacional (con
 * +, aunque venga con espacios o guiones) se agrupa por país: Norteamérica
 * +1 415 555 0132, Argentina +54 9 11 5555-0100, Brasil +55 11 91234-5678,
 * México +52 55 1234 5678 y el resto código de país y grupos de a 4 desde el
 * final. Un número local sin + queda como lo escribió la persona.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  if (!raw.startsWith('+') || /[^\d\s().+-]/.test(raw)) return raw;
  const d = raw.replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return raw;
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.startsWith('54')) {
    const ar = formatArgentina(d.slice(2));
    if (ar) return ar;
  }
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const sub = d.slice(4);
    return `+55 ${d.slice(2, 4)} ${sub.slice(0, -4)}-${sub.slice(-4)}`;
  }
  if (d.startsWith('52') && d.length === 12) {
    const n = d.slice(2);
    const areaLen = /^(55|56|33|81)/.test(n) ? 2 : 3;
    const sub = n.slice(areaLen);
    return `+52 ${n.slice(0, areaLen)} ${sub.slice(0, -4)} ${sub.slice(-4)}`;
  }
  const cc = d.startsWith('7') ? '7' : TWO_DIGIT_CC.has(d.slice(0, 2)) ? d.slice(0, 2) : d.slice(0, 3);
  let rest = d.slice(cc.length);
  const groups: string[] = [];
  while (rest.length > 4) {
    groups.unshift(rest.slice(-4));
    rest = rest.slice(0, -4);
  }
  if (rest) groups.unshift(rest);
  return `+${cc} ${groups.join(' ')}`;
}

/** Duración de una llamada para leer: segundos si dura menos de un minuto (45 s, 3 min). */
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  return `${Math.round(s / 60)} min`;
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
