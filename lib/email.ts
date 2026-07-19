/**
 * Email — envío simple de confirmaciones. Sin dependencias externas.
 * - Resend: si existe RESEND_API_KEY se envía vía fetch.
 * - SMTP: si existe SMTP_HOST se loguea un mock (no hay cliente SMTP instalado).
 * - Fallback: loguea en consola para desarrollo/demo.
 *
 * Templates: mínimos, blanco/negro, monospace (marca zerosoft). El brand_color
 * del event type solo aparece como acento pequeño.
 */

interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
  const provider = process.env.SMTP_HOST ? 'smtp_mock' : 'console';
  // eslint-disable-next-line no-console
  console.log(`[email:${provider}] to=${opts.to} from=${fromEmail()} subject="${opts.subject}"`);
  // eslint-disable-next-line no-console
  console.log(opts.text);
  return { ok: true, provider };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; provider?: string; id?: string; error?: string }> {
  const resend = await sendResend(opts);
  if (resend.ok) return { ok: true, provider: 'resend', id: resend.id };

  const mock = sendMock(opts);
  return { ok: true, provider: mock.provider };
}

// ---------- Templates ----------

const MONO_STACK = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

function safeHex(color: string | null | undefined): string | null {
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWhen(start: Date, timezone: string): string {
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
function renderBrandedHtml(opts: {
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

interface BookingMailDetails {
  eventTitle: string;
  start: Date;
  end: Date;
  timezone: string;
  location: string;
  brandColor?: string | null;
  logoUrl?: string | null;
}

function detailLines(d: BookingMailDetails): string[] {
  const lines = [`${formatWhen(d.start, d.timezone)} (${escapeHtml(d.timezone)})`];
  if (d.location) lines.push(`Location: ${escapeHtml(d.location)}`);
  return lines;
}

export async function sendBookingConfirmation(opts: {
  to: string;
  eventTitle: string;
  start: Date;
  end: Date;
  timezone: string;
  location: string;
  guestName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const dateText = formatWhen(opts.start, opts.timezone);

  const subject = `Booking confirmed: ${opts.eventTitle}`;
  const text = `Hi ${opts.guestName},

Your booking for "${opts.eventTitle}" is confirmed.

${dateText} (${opts.timezone})
${opts.location ? `Location: ${opts.location}` : ''}

See you then.
`;
  const html = renderBrandedHtml({
    heading: 'Booking confirmed',
    brandColor: opts.brandColor,
    logoUrl: opts.logoUrl,
    paragraphs: [
      `Hi ${escapeHtml(opts.guestName)}, your booking for <strong>${escapeHtml(opts.eventTitle)}</strong> is confirmed.`,
      ...detailLines(opts),
      'See you then.',
    ],
  });

  const sent = await sendEmail({ to: opts.to, subject, text, html });
  return { ok: sent.ok, provider: sent.provider, error: sent.error };
}

/** Aviso al host (owner del event type o host asignado por round-robin). */
export async function sendHostBookingNotification(opts: {
  to: string;
  hostName: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  start: Date;
  end: Date;
  timezone: string;
  location: string;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const dateText = formatWhen(opts.start, opts.timezone);

  const subject = `New booking: ${opts.eventTitle} — ${opts.guestName}`;
  const text = `Hi ${opts.hostName},

${opts.guestName} (${opts.guestEmail}) booked "${opts.eventTitle}".

${dateText} (${opts.timezone})
${opts.location ? `Location: ${opts.location}` : ''}
`;
  const html = renderBrandedHtml({
    heading: 'New booking',
    paragraphs: [
      `Hi ${escapeHtml(opts.hostName)}, <strong>${escapeHtml(opts.guestName)}</strong> (${escapeHtml(opts.guestEmail)}) booked <strong>${escapeHtml(opts.eventTitle)}</strong>.`,
      ...detailLines(opts),
    ],
  });

  const sent = await sendEmail({ to: opts.to, subject, text, html });
  return { ok: sent.ok, provider: sent.provider, error: sent.error };
}

/** Recordatorio 24h antes para el invitee. */
export async function sendBookingReminder(opts: {
  to: string;
  guestName: string;
  eventTitle: string;
  start: Date;
  timezone: string;
  location: string;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const dateText = formatWhen(opts.start, opts.timezone);

  const subject = `Reminder: ${opts.eventTitle} tomorrow`;
  const text = `Hi ${opts.guestName},

Reminder: "${opts.eventTitle}" is coming up in about 24 hours.

${dateText} (${opts.timezone})
${opts.location ? `Location: ${opts.location}` : ''}

See you then.
`;
  const html = renderBrandedHtml({
    heading: 'Reminder',
    paragraphs: [
      `Hi ${escapeHtml(opts.guestName)}, <strong>${escapeHtml(opts.eventTitle)}</strong> is coming up in about 24 hours.`,
      ...detailLines({ ...opts, end: opts.start }),
      'See you then.',
    ],
  });

  const sent = await sendEmail({ to: opts.to, subject, text, html });
  return { ok: sent.ok, provider: sent.provider, error: sent.error };
}
