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
}

export interface SmsSettingsView {
  configured: boolean;
  accountSid: string;
  fromNumber: string;
  /** Últimos 4 del token, para reconocerlo. */
  tokenHint: string | null;
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
  input: { accountSid: string; authToken?: string; fromNumber: string },
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
  await getDb()
    .prepare(
      `INSERT INTO calendar_sms_settings (user_id, account_sid, auth_token, from_number, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET account_sid = excluded.account_sid, auth_token = excluded.auth_token,
         from_number = excluded.from_number, updated_at = datetime('now')`,
    )
    .run(workspaceId, sid, seal(token), from);
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

export type SmsResult = { ok: true; sid: string } | { ok: false; code: 'not_configured' | 'invalid_phone' | 'send_failed'; retry: boolean };

/** Manda un SMS con la cuenta del workspace. `retry`: si vale la pena reintentar (fallo de red o de Twilio). */
export async function sendCalSms(workspaceId: string, to: string, body: string): Promise<SmsResult> {
  const phone = toE164(to);
  if (!phone) return { ok: false, code: 'invalid_phone', retry: false };
  const r = await row(workspaceId);
  const token = r ? open(r.auth_token) : '';
  if (!r?.account_sid || !token || !r.from_number) return { ok: false, code: 'not_configured', retry: false };
  const text = body.slice(0, SMS_MAX_CHARS);
  if (fakeSmsAllowed()) {
    fakeSmsOutbox().push({ workspaceId, to: phone, from: r.from_number, body: text });
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
  return { ok: true, sid: data.sid };
}
