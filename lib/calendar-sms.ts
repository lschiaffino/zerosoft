/**
 * Cal — SMS de los workflows (recordatorios y avisos por texto) con la
 * cuenta de Twilio del propio workspace: Account SID, Auth Token (cifrado
 * con lib/secret-box.ts, nunca vuelve a la UI) y el número que envía (E.164 o
 * un Messaging Service SID "MG…"). La API es la REST de Twilio
 * (POST /2010-04-01/Accounts/{sid}/Messages.json, basic auth), sin SDK.
 *
 * CAL_SMS_FAKE=1 (con NODE_ENV=test o DEMO_MODE=true, como los otros fakes)
 * no sale a Twilio: acepta cualquier credencial con el formato correcto y
 * guarda los mensajes en memoria (fakeSmsOutbox) para los tests.
 * Server-only.
 */
import { getDb } from './db';
import { open, seal } from './secret-box';
import { safeFetch } from './safe-fetch';

export const TWILIO_SID = /^AC[0-9a-f]{32}$/i;
/** Número E.164 (+5491112345678) o Messaging Service (MG + 32 hex). */
export const SMS_FROM = /^(\+[1-9]\d{6,14}|MG[0-9a-f]{32})$/i;
const E164 = /^\+[1-9]\d{6,14}$/;
/** Twilio parte en segmentos; un recordatorio no necesita más de 4. */
export const SMS_MAX_CHARS = 612;
/** Tope diario por defecto (cada SMS lo cobra Twilio a la cuenta del workspace). */
export const SMS_DEFAULT_DAILY_LIMIT = 200;
export const SMS_MAX_DAILY_LIMIT = 5000;
/** El mismo paso no se vuelve a mandar a la misma reserva dentro de esta ventana (reprogramaciones). */
const SMS_DEDUPE_MS = 24 * 60 * 60 * 1000;

/**
 * Códigos de país (ITU E.164). El de un número es el prefijo más largo que
 * coincide: así +1 (NANP), +54 (Argentina) o +598 (Uruguay).
 */
const CALLING_CODES = new Set(
  (
    '1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 ' +
    '211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 248 249 ' +
    '250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 ' +
    '370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 ' +
    '594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 ' +
    '960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998'
  ).split(' '),
);

/** Código de país de un número E.164 (sin +), o null. */
export function callingCode(e164: string): string | null {
  const digits = e164.replace(/^\+/, '');
  for (const len of [3, 2, 1]) {
    const code = digits.slice(0, len);
    if (CALLING_CODES.has(code)) return code;
  }
  return null;
}

/** "+54, 1 , 598" → ['54', '1', '598'] (solo códigos válidos, sin repetir). */
export function parseCallingCodes(raw: string | string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : (raw ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((c) => c.replace(/\D/g, '')).filter((c) => CALLING_CODES.has(c)))].slice(0, 50);
}

export function fakeSmsAllowed(): boolean {
  if (process.env.CAL_SMS_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

const g = globalThis as unknown as { __zsCalSms?: Array<{ workspaceId: string; to: string; from: string; body: string }> };

/** Mensajes "enviados" en modo fake (tests). */
export function fakeSmsOutbox(): Array<{ workspaceId: string; to: string; from: string; body: string }> {
  g.__zsCalSms ??= [];
  return g.__zsCalSms;
}

interface SmsRow {
  user_id: string;
  account_sid: string;
  auth_token: string;
  from_number: string;
  allowed_codes: string;
  daily_limit: number;
}

export interface SmsSettingsView {
  configured: boolean;
  accountSid: string;
  fromNumber: string;
  /** Últimos 4 del token, para reconocerlo. */
  tokenHint: string | null;
  /** Países a los que se manda (códigos sin +). Vacío = solo el del número que envía. */
  allowedCodes: string[];
  dailyLimit: number;
  /** SMS mandados en las últimas 24 horas. */
  sentToday: number;
}

/** Países permitidos: los elegidos o, sin elegir, el del número que envía. */
function allowedCodesOf(r: Pick<SmsRow, 'allowed_codes' | 'from_number'>): string[] {
  const chosen = parseCallingCodes(r.allowed_codes);
  if (chosen.length > 0) return chosen;
  const own = r.from_number.startsWith('+') ? callingCode(r.from_number) : null;
  return own ? [own] : [];
}

async function sentInLastDay(workspaceId: string): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT COUNT(*) AS n FROM calendar_sms_sends WHERE user_id = ? AND sent_at > ?')
    .get(workspaceId, new Date(Date.now() - 86_400_000).toISOString())) as { n: number };
  return Number(row?.n ?? 0);
}

async function row(workspaceId: string): Promise<SmsRow | undefined> {
  return (await getDb().prepare('SELECT * FROM calendar_sms_settings WHERE user_id = ?').get(workspaceId)) as SmsRow | undefined;
}

export async function getSmsSettings(workspaceId: string): Promise<SmsSettingsView> {
  const r = await row(workspaceId);
  const token = r ? open(r.auth_token) : '';
  return {
    configured: !!(r?.account_sid && token && r.from_number),
    accountSid: r?.account_sid ?? '',
    fromNumber: r?.from_number ?? '',
    tokenHint: token ? `…${token.slice(-4)}` : null,
    allowedCodes: r ? allowedCodesOf(r) : [],
    dailyLimit: r?.daily_limit ?? SMS_DEFAULT_DAILY_LIMIT,
    sentToday: await sentInLastDay(workspaceId),
  };
}

export class SmsError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

/**
 * Guarda la cuenta de Twilio. Sin token nuevo se conserva el guardado. Antes
 * de guardar se valida contra Twilio (GET de la cuenta) para no descubrir el
 * error recién en el primer recordatorio.
 */
export async function saveSmsSettings(
  workspaceId: string,
  input: { accountSid: string; authToken?: string; fromNumber: string; allowedCodes?: string[] | string; dailyLimit?: number },
): Promise<SmsSettingsView> {
  const sid = input.accountSid.trim();
  const from = input.fromNumber.trim();
  if (!TWILIO_SID.test(sid) || !SMS_FROM.test(from)) throw new SmsError('invalid_input');
  const existing = await row(workspaceId);
  const token = input.authToken?.trim() || (existing ? open(existing.auth_token) : '');
  if (!/^[0-9a-f]{32}$/i.test(token)) throw new SmsError('invalid_input');
  if (!fakeSmsAllowed()) {
    const res = await safeFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
      { headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } },
      10_000,
    ).catch(() => null);
    if (!res?.ok) throw new SmsError('sms_auth_failed', 400);
  }
  const codes = input.allowedCodes !== undefined ? parseCallingCodes(input.allowedCodes) : parseCallingCodes(existing?.allowed_codes);
  // Con un Messaging Service no se sabe el país: hay que elegir a cuáles se manda.
  if (codes.length === 0 && !from.startsWith('+')) throw new SmsError('sms_countries_required');
  const limit = Math.min(SMS_MAX_DAILY_LIMIT, Math.max(1, Math.round(input.dailyLimit ?? existing?.daily_limit ?? SMS_DEFAULT_DAILY_LIMIT)));
  await getDb()
    .prepare(
      `INSERT INTO calendar_sms_settings (user_id, account_sid, auth_token, from_number, allowed_codes, daily_limit, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET account_sid = excluded.account_sid, auth_token = excluded.auth_token,
         from_number = excluded.from_number, allowed_codes = excluded.allowed_codes, daily_limit = excluded.daily_limit,
         updated_at = datetime('now')`,
    )
    .run(workspaceId, sid, seal(token), from, codes.join(','), limit);
  return getSmsSettings(workspaceId);
}

export async function deleteSmsSettings(workspaceId: string): Promise<void> {
  await getDb().prepare('DELETE FROM calendar_sms_settings WHERE user_id = ?').run(workspaceId);
}

/** Teléfono a E.164: deja + y dígitos; sin + no se puede saber el país, así que no sirve. */
export function toE164(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/[\s().-]/g, '');
  return E164.test(v) ? v : null;
}

export type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; code: 'not_configured' | 'invalid_phone' | 'send_failed' | 'country_blocked' | 'daily_limit' | 'duplicate'; retry: boolean };

/**
 * Manda un SMS con la cuenta del workspace. Antes revisa que el país esté
 * permitido, que no se pase el tope diario y que ese paso no se haya mandado
 * ya a esa reserva en las últimas 24 horas (una reprogramación no lo repite).
 * `retry`: si vale la pena reintentar (fallo de red o de Twilio).
 */
export async function sendCalSms(
  workspaceId: string,
  to: string,
  body: string,
  ctx: { bookingId?: string; stepId?: string } = {},
): Promise<SmsResult> {
  const phone = toE164(to);
  if (!phone) return { ok: false, code: 'invalid_phone', retry: false };
  const r = await row(workspaceId);
  const token = r ? open(r.auth_token) : '';
  if (!r?.account_sid || !token || !r.from_number) return { ok: false, code: 'not_configured', retry: false };
  const code = callingCode(phone);
  if (!code || !allowedCodesOf(r).includes(code)) return { ok: false, code: 'country_blocked', retry: false };
  if (ctx.stepId && ctx.bookingId) {
    const dup = await getDb()
      .prepare('SELECT 1 AS one FROM calendar_sms_sends WHERE step_id = ? AND booking_id = ? AND sent_at > ?')
      .get(ctx.stepId, ctx.bookingId, new Date(Date.now() - SMS_DEDUPE_MS).toISOString());
    if (dup) return { ok: false, code: 'duplicate', retry: false };
  }
  if ((await sentInLastDay(workspaceId)) >= (r.daily_limit || SMS_DEFAULT_DAILY_LIMIT)) return { ok: false, code: 'daily_limit', retry: false };
  const text = body.slice(0, SMS_MAX_CHARS);
  const record = () =>
    getDb()
      .prepare('INSERT INTO calendar_sms_sends (id, user_id, booking_id, step_id, sent_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), workspaceId, ctx.bookingId ?? null, ctx.stepId ?? null, new Date().toISOString());
  if (fakeSmsAllowed()) {
    fakeSmsOutbox().push({ workspaceId, to: phone, from: r.from_number, body: text });
    await record();
    return { ok: true, sid: `SMfake${fakeSmsOutbox().length}` };
  }
  const params = new URLSearchParams({ To: phone, Body: text });
  if (r.from_number.startsWith('MG')) params.set('MessagingServiceSid', r.from_number);
  else params.set('From', r.from_number);
  const res = await safeFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(r.account_sid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${r.account_sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
    10_000,
  ).catch(() => null);
  if (!res) return { ok: false, code: 'send_failed', retry: true };
  const data = (await res.json().catch(() => ({}))) as { sid?: string };
  if (!res.ok || !data.sid) return { ok: false, code: 'send_failed', retry: res.status >= 500 || res.status === 429 };
  await record();
  return { ok: true, sid: data.sid };
}
