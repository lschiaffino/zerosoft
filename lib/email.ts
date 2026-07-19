/**
 * Email — envío simple de confirmaciones. Sin dependencias externas.
 * - Resend: si existe RESEND_API_KEY se envía vía fetch.
 * - SMTP: si existe SMTP_HOST se loguea un mock (no hay cliente SMTP instalado).
 * - Fallback: loguea en consola para desarrollo/demo.
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

export async function sendBookingConfirmation(opts: {
  to: string;
  eventTitle: string;
  start: Date;
  end: Date;
  timezone: string;
  location: string;
  guestName: string;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  const dateText = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: opts.timezone,
  }).format(opts.start);

  const subject = `Booking confirmed: ${opts.eventTitle}`;
  const text = `Hi ${opts.guestName},

Your booking for "${opts.eventTitle}" is confirmed.

${dateText} (${opts.timezone})
${opts.location ? `Location: ${opts.location}` : ''}

See you then.
`;

  const resend = await sendResend({ to: opts.to, subject, text });
  if (resend.ok) return { ok: true, provider: 'resend' };

  const mock = sendMock({ to: opts.to, subject, text });
  return { ok: true, provider: mock.provider };
}
