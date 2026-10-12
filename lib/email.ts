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
}

function fromEmail(): string {
  return process.env.EMAIL_FROM ?? 'calendar@zerosoft.ai';
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
        from: fromEmail(),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
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
  console.log(`[email:${provider}] to=${opts.to} from=${fromEmail()} subject="${opts.subject}"`);
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

export function formatWhen(start: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
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
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888888;">zerosoft · cal</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:500;letter-spacing:-0.01em;color:#000000;border-bottom:2px solid ${accent};display:inline-block;padding-bottom:6px;">${escapeHtml(opts.heading)}</h1>
    ${paragraphs}
    <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:11px;color:#999999;">zerosoft.ai — software that costs zero</p>
  </div>
</body></html>`;
}

function detailLines(d: { start: Date; timezone: string; location: string }): string[] {
  const lines = [`${formatWhen(d.start, d.timezone)} (${escapeHtml(d.timezone)})`];
  if (d.location) lines.push(`Location: ${escapeHtml(d.location)}`);
  return lines;
}

/** Recordatorio 24h antes para el invitee. */
export async function sendBookingReminder(opts: {
  to: string;
  guestName: string;
  eventTitle: string;
  start: Date;
  timezone: string;
  location: string;
  manageUrl?: string | null;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const dateText = formatWhen(opts.start, opts.timezone);

  const subject = `Reminder: ${opts.eventTitle} tomorrow`;
  const text = `Hi ${opts.guestName},

Reminder: "${opts.eventTitle}" is coming up in about 24 hours.

${dateText} (${opts.timezone})
${opts.location ? `Location: ${opts.location}` : ''}
${opts.manageUrl ? `\nCan't make it? Reschedule or cancel: ${opts.manageUrl}\n` : ''}
See you then.
`;
  const html = renderBrandedHtml({
    heading: 'Reminder',
    paragraphs: [
      `Hi ${escapeHtml(opts.guestName)}, <strong>${escapeHtml(opts.eventTitle)}</strong> is coming up in about 24 hours.`,
      ...detailLines(opts),
      ...(opts.manageUrl
        ? [`Can't make it? <a href="${escapeHtml(opts.manageUrl)}">Reschedule or cancel</a>.`]
        : []),
      'See you then.',
    ],
  });

  const sent = await sendEmail({ to: opts.to, subject, text, html });
  return { ok: sent.ok, provider: sent.provider, error: sent.error };
}
