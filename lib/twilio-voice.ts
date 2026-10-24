/**
 * Twilio Voice para llamar desde el navegador (puro + REST, sin SDK de
 * servidor): access token JWT para el Voice JS SDK, validación de la firma de
 * los webhooks, TwiML de salida/entrada/aviso de grabación y la API REST
 * (grabaciones, números del account, llamadas hijas).
 *
 * Config de la instancia:
 * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (firma de webhooks y REST)
 * - TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET (firma del access token)
 * - TWILIO_TWIML_APP_SID: TwiML App cuyo Voice URL es <app>/api/crm/voice/twiml
 * Cada workspace elige su número (caller ID) del account en Ajustes.
 *
 * Con CRM_VOICE_FAKE=1 (y NODE_ENV=test o DEMO_MODE=true) no se habla con
 * Twilio: el navegador usa un dispositivo simulado (lib/crm-voice-fake.ts).
 * Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const API = 'https://api.twilio.com/2010-04-01';

export function fakeVoiceAllowed(): boolean {
  if (process.env.CRM_VOICE_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export const VOICE_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_TWIML_APP_SID',
] as const;

/** Variables que faltan para la integración real (vacío = configurada). */
export function missingVoiceEnv(): string[] {
  if (fakeVoiceAllowed()) return [];
  return VOICE_ENV.filter((k) => !process.env[k]);
}

export function voiceConfigured(): boolean {
  return missingVoiceEnv().length === 0;
}

export function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Identidad del cliente Voice: una por persona y workspace (solo [A-Za-z0-9_]). */
export function voiceIdentity(workspaceId: string, personId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 48);
  return `zs_${clean(workspaceId)}_${clean(personId)}`;
}

/** Número E.164 (+ y 8 a 15 dígitos) o null. */
export function e164(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s.startsWith('+') && !s.startsWith('00')) return null;
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

// ---------- Access token (JWT HS256) ----------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Access token del Voice JS SDK: grant de voz con la TwiML App para salientes
 * y entrantes habilitadas para esta identidad. Vence en `ttlSec` (máx 24 h).
 */
export function voiceAccessToken(identity: string, opts: { ttlSec?: number; now?: number } = {}): string {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const ttl = Math.min(Math.max(opts.ttlSec ?? 3600, 60), 86_400);
  const keySid = process.env.TWILIO_API_KEY_SID ?? '';
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${keySid}-${now}`,
    iss: keySid,
    sub: process.env.TWILIO_ACCOUNT_SID ?? '',
    iat: now,
    nbf: now,
    exp: now + ttl,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: process.env.TWILIO_TWIML_APP_SID ?? '' },
      },
    },
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac('sha256', process.env.TWILIO_API_KEY_SECRET ?? '').update(body).digest('base64url');
  return `${body}.${sig}`;
}

// ---------- Firma de webhooks ----------

/**
 * X-Twilio-Signature: HMAC-SHA1 (auth token) de la URL completa + cada
 * parámetro POST (ordenados por nombre) concatenado nombre+valor, en base64.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const expected = Buffer.from(twilioSignature(token, url, params));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/**
 * Lee el form de un webhook de Twilio y valida la firma contra la URL
 * pública (NEXTAUTH_URL + path + query, que es la que firmó Twilio).
 */
export async function readTwilioWebhook(req: Request): Promise<{ ok: boolean; params: Record<string, string> }> {
  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((v, k) => {
    if (typeof v === 'string') params[k] = v;
  });
  const u = new URL(req.url);
  const publicUrl = `${appBase()}${u.pathname}${u.search}`;
  return { ok: validTwilioSignature(publicUrl, params, req.headers.get('x-twilio-signature')), params };
}

// ---------- TwiML ----------

export function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function twimlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { 'content-type': 'text/xml; charset=utf-8' } });
}

/** Idiomas de <Say> de Twilio para el aviso (por el idioma de la transcripción). */
export function sayLanguage(lang: string): string {
  const l = lang.toLowerCase();
  if (l.startsWith('es')) return 'es-MX';
  if (l.startsWith('pt')) return 'pt-BR';
  return 'en-US';
}

export interface DialTwimlInput {
  callId: string;
  to: string;
  callerId: string;
  record: boolean;
  consent: boolean;
  transcribe: boolean;
  language: string;
  /** Entrantes: identidades de cliente a las que suena (en vez de un número). */
  clients?: string[];
  /** Entrantes: el aviso suena antes de conectar a quien llama. */
  consentText?: string;
}

function eventsUrl(kind: string, callId: string): string {
  return `${appBase()}/api/crm/voice/events?${new URLSearchParams({ kind, call: callId }).toString()}`;
}

/**
 * TwiML de una llamada: transcripción en tiempo real de las dos pistas (si
 * está activa), <Dial> con grabación de las dos pistas desde que atienden y
 * el aviso de grabación a la otra parte (url del <Number>, que suena al
 * atender, antes de conectar).
 */
export function dialTwiml(input: DialTwimlInput): string {
  const parts: string[] = [];
  if (input.clients && input.consent && input.record && input.consentText) {
    parts.push(`<Say language="${sayLanguage(input.language)}">${xmlEscape(input.consentText)}</Say>`);
  }
  if (input.transcribe) {
    parts.push(
      `<Start><Transcription statusCallbackUrl="${xmlEscape(eventsUrl('transcription', input.callId))}" track="both_tracks" languageCode="${xmlEscape(input.language)}" partialResults="false"/></Start>`,
    );
  }
  const dialAttrs = [
    `action="${xmlEscape(eventsUrl('dial', input.callId))}"`,
    'method="POST"',
    'timeout="30"',
    'answerOnBridge="true"',
  ];
  if (input.callerId) dialAttrs.push(`callerId="${xmlEscape(input.callerId)}"`);
  if (input.record) {
    dialAttrs.push(
      'record="record-from-answer-dual"',
      `recordingStatusCallback="${xmlEscape(eventsUrl('recording', input.callId))}"`,
      'recordingStatusCallbackEvent="completed"',
    );
  }
  const target = input.clients
    ? input.clients.map((c) => `<Client>${xmlEscape(c)}</Client>`).join('')
    : input.consent && input.record
      ? `<Number url="${xmlEscape(`${appBase()}/api/crm/voice/consent?${new URLSearchParams({ call: input.callId }).toString()}`)}">${xmlEscape(input.to)}</Number>`
      : `<Number>${xmlEscape(input.to)}</Number>`;
  parts.push(`<Dial ${dialAttrs.join(' ')}>${target}</Dial>`);
  return twiml(parts.join(''));
}

export function sayTwiml(text: string, language: string): string {
  return twiml(`<Say language="${sayLanguage(language)}">${xmlEscape(text)}</Say>`);
}

export function rejectTwiml(): string {
  return twiml('<Reject/>');
}

// ---------- REST ----------

function basicAuth(): string {
  // API key + secret sirven para REST; si no, Account SID + Auth Token.
  const user = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID || '';
  const pass = process.env.TWILIO_API_KEY_SID ? process.env.TWILIO_API_KEY_SECRET : process.env.TWILIO_AUTH_TOKEN;
  return `Basic ${Buffer.from(`${user}:${pass ?? ''}`).toString('base64')}`;
}

async function twilioGet<T>(path: string): Promise<T | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const res = await fetch(`${API}/Accounts/${encodeURIComponent(sid)}${path}`, {
    headers: { authorization: basicAuth() },
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/** El número es del account (comprado o caller ID verificado): otro workspace no puede usar uno ajeno. */
export async function numberBelongsToAccount(number: string): Promise<boolean> {
  if (fakeVoiceAllowed()) return true;
  const q = `PhoneNumber=${encodeURIComponent(number)}`;
  const owned = await twilioGet<{ incoming_phone_numbers?: unknown[] }>(`/IncomingPhoneNumbers.json?${q}`);
  if (owned?.incoming_phone_numbers?.length) return true;
  const verified = await twilioGet<{ outgoing_caller_ids?: unknown[] }>(`/OutgoingCallerIds.json?${q}`);
  return Boolean(verified?.outgoing_caller_ids?.length);
}

/** Llamada hija (la que se marcó desde el <Dial>) de una llamada del navegador. */
export async function childCallResult(parentSid: string): Promise<{ status: string; duration: number } | null> {
  const data = await twilioGet<{ calls?: Array<{ status?: string; duration?: string | null }> }>(
    `/Calls.json?ParentCallSid=${encodeURIComponent(parentSid)}&PageSize=5`,
  );
  const child = data?.calls?.[0];
  if (!child) return null;
  return { status: child.status ?? 'completed', duration: Number(child.duration ?? 0) || 0 };
}

/** Audio de una grabación (mp3), con las credenciales del server: nunca se exponen al navegador. */
export async function fetchRecording(recordingSid: string): Promise<Response | null> {
  if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)) return null;
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const res = await fetch(`${API}/Accounts/${encodeURIComponent(sid)}/Recordings/${recordingSid}.mp3`, {
    headers: { authorization: basicAuth() },
  }).catch(() => null);
  return res?.ok ? res : null;
}

/** A quién se marcó en una llamada (p. ej. "client:zs_…" en una entrante atendida). */
export async function callTo(callSid: string): Promise<string | null> {
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return null;
  const data = await twilioGet<{ to?: string }>(`/Calls/${callSid}.json`);
  return data?.to ?? null;
}
