/**
 * Email — envío simple de confirmaciones. Sin dependencias externas.
 * - Resend: si existe RESEND_API_KEY se envía vía fetch.
 * - Sin RESEND_API_KEY: loguea en consola (desarrollo/demo).
 * Si Resend está configurado y falla, devuelve ok:false (para poder reintentar).
 *
 * Templates: mínimos, blanco/negro, monospace (marca zerosoft). El brand_color
 * del event type solo aparece como acento pequeño.
 */

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Remitente; por defecto el de EMAIL_FROM (o el de Calendar). Los avisos de apps usan appSender(). */
  from?: string;
  /** Reply-To (Chat: la dirección de entrada de la conversación, lib/chat-email.ts). */
  replyTo?: string;
  /** Headers extra (Chat: In-Reply-To y References para agrupar el hilo). */
  headers?: Record<string, string>;
}

function fromEmail(): string {
  return process.env.EMAIL_FROM ?? 'calendar@zerosoft.ai';
}

/** Remitente con otro nombre visible y la misma dirección (Chat: el nombre del widget). */
export function namedSender(name: string): string {
  const base = appSender();
  const address = base.match(/<([^>]+)>/)?.[1] ?? base.trim();
  const clean = name.replace(/["\\<>\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean ? `"${clean}" <${address}>` : base;
}

/**
 * Remitente general de la app para avisos que no son de Calendar (SLA y
 * recordatorios de Groups, etc.): EMAIL_FROM, salvo que sea la casilla de
 * Calendar; si no, notifications@ del dominio.
 */
export function appSender(): string {
  const env = process.env.EMAIL_FROM?.trim();
  if (env && !/(^|<)\s*calendar@/i.test(env)) return env;
  return 'zerosoft <notifications@zerosoft.ai>';
}

async function sendResend(opts: SendOptions): Promise<{ id?: string; ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from ?? fromEmail(),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'utf8').toString('base64'),
          content_type: a.contentType,
        })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message ?? `resend_${res.status}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'resend_error' };
  }
}

function sendMock(opts: SendOptions): { ok: true; provider: string } {
  const provider = 'console';
  // eslint-disable-next-line no-console
  console.log(`[email:${provider}] to=${opts.to} from=${opts.from ?? fromEmail()} subject="${opts.subject}"`);
  // eslint-disable-next-line no-console
  console.log(opts.text);
  if (opts.attachments?.length) {
    // eslint-disable-next-line no-console
    console.log(`[email:${provider}] attachments: ${opts.attachments.map((a) => a.filename).join(', ')}`);
  }
  return { ok: true, provider };
}

export async function sendEmail(opts: SendOptions): Promise<{ ok: boolean; provider?: string; id?: string; error?: string }> {
  if (process.env.RESEND_API_KEY) {
    const resend = await sendResend(opts);
    if (resend.ok) return { ok: true, provider: 'resend', id: resend.id };
    // eslint-disable-next-line no-console
    console.error(`[email:resend] failed to=${opts.to} error=${resend.error ?? 'unknown'}`);
    return { ok: false, provider: 'resend', error: resend.error ?? 'resend_error' };
  }

  const mock = sendMock(opts);
  return { ok: true, provider: mock.provider };
}

// ---------- Templates ----------

const MONO_STACK = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

function safeHex(color: string | null | undefined): string | null {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatWhen(start: Date, timezone: string, locale = 'en'): string {
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(start);
}

/** HTML mínimo blanco/negro: hairline, mono, acento de marca opcional. */
export function renderBrandedHtml(opts: {
  heading: string;
  paragraphs: string[];
  brandColor?: string | null;
  logoUrl?: string | null;
  /** Línea chica sobre el título (default "zerosoft · cal"). */
  eyebrow?: string;
}): string {
  const accent = safeHex(opts.brandColor) ?? '#000000';
  const logo =
    opts.logoUrl && /^(https:\/\/|http:\/\/|\/)/.test(opts.logoUrl)
      ? `<img src="${escapeHtml(opts.logoUrl)}" alt="" width="96" style="display:block;max-height:40px;width:auto;margin:0 0 24px;" />`
      : '';
  const paragraphs = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#111111;">${p}</p>`,
    )
    .join('');
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:${MONO_STACK};">
    ${logo}
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888888;">${escapeHtml(opts.eyebrow ?? 'zerosoft · cal')}</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:500;letter-spacing:-0.01em;color:#000000;border-bottom:2px solid ${accent};display:inline-block;padding-bottom:6px;">${escapeHtml(opts.heading)}</h1>
    ${paragraphs}
    <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:11px;color:#999999;">zerosoft.ai — software that costs zero</p>
  </div>
</body></html>`;
}

const REMINDER_COPY = {
  en: { subject: 'Reminder: {event} tomorrow', heading: 'Reminder', hi: 'Hi {name},', line: '<strong>{event}</strong> is coming up in about 24 hours.', where: 'Location', change: "Can't make it? <a href=\"{url}\">Reschedule or cancel</a>.", bye: 'See you then.' },
  es: { subject: 'Recordatorio: {event} mañana', heading: 'Recordatorio', hi: 'Hola {name},', line: '<strong>{event}</strong> es en unas 24 horas.', where: 'Lugar', change: '¿No podés? <a href=\"{url}\">Reprogramar o cancelar</a>.', bye: '¡Nos vemos!' },
  pt: { subject: 'Lembrete: {event} amanhã', heading: 'Lembrete', hi: 'Olá {name},', line: '<strong>{event}</strong> é daqui a cerca de 24 horas.', where: 'Local', change: 'Não vai poder? <a href=\"{url}\">Reagendar ou cancelar</a>.', bye: 'Até lá!' },
};

/** Recordatorio 24h antes para el invitee, en su idioma. */
export async function sendBookingReminder(opts: {
  to: string;
  guestName: string;
  eventTitle: string;
  start: Date;
  timezone: string;
  location: string;
  manageUrl?: string | null;
  locale?: string | null;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const lang = opts.locale === 'es' || opts.locale === 'pt' ? opts.locale : 'en';
  const c = REMINDER_COPY[lang];
  const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
  const strip = (h: string) => h.replace(/<[^>]+>/g, '');
  const paragraphs = [
    `${fill(c.hi, { name: escapeHtml(opts.guestName) })} ${fill(c.line, { event: escapeHtml(opts.eventTitle) })}`,
    `${escapeHtml(formatWhen(opts.start, opts.timezone, lang))} (${escapeHtml(opts.timezone)})`,
    ...(opts.location ? [`${c.where}: ${escapeHtml(opts.location)}`] : []),
    ...(opts.manageUrl ? [fill(c.change, { url: escapeHtml(opts.manageUrl) })] : []),
    c.bye,
  ];
  const sent = await sendEmail({
    to: opts.to,
    subject: fill(c.subject, { event: opts.eventTitle }),
    text: paragraphs.map(strip).join('\n\n') + (opts.manageUrl ? `\n\n${opts.manageUrl}` : ''),
    html: renderBrandedHtml({ heading: c.heading, paragraphs }),
  });
  return { ok: sent.ok, provider: sent.provider, error: sent.error };
}
