import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  fetchReceivedAttachments,
  fetchReceivedEmail,
  htmlToText,
  inboundFake,
  processInboundEmail,
  readAuthentication,
  verifySvixSignature,
  type InboundAttachment,
} from '@/lib/chat-email';

export const dynamic = 'force-dynamic';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Webhook de Resend (evento email.received): un email a reply+… o inbox+…
 * entra a la conversación. Firma Svix con RESEND_WEBHOOK_SECRET; sin secreto
 * (y fuera del modo de prueba CHAT_INBOUND_FAKE) responde 503. Siempre 200
 * a un email que no es para nosotros, así Resend no reintenta.
 *
 * El destino sale de `to`, `cc` y `received_for`: un email reenviado desde el
 * soporte@ del cliente conserva `To: soporte@…` y nuestra dirección llega en
 * `received_for` (ejemplo de la doc de Resend: to ["delivered@resend.dev"],
 * received_for ["forwarded@example.com"]).
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-inbound', 120, 60);
  if (limited) return limited;
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? '';
  const fake = inboundFake();
  if (secret) {
    const ok = verifySvixSignature(raw, {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    }, secret);
    if (!ok) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  } else if (!fake) {
    return NextResponse.json({ error: 'inbound_disabled' }, { status: 503 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (event?.type !== 'email.received' || !event.data) return NextResponse.json({ ok: true, ignored: 'event' });
  const d = event.data;
  const emailId = typeof d.email_id === 'string' ? d.email_id : '';
  const from = typeof d.from === 'string' ? d.from : '';
  const recipients = [...strings(d.to), ...strings(d.cc), ...strings(d.received_for)];
  if (!emailId || !from || recipients.length === 0) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // El webhook trae solo metadatos: el resto se pide a la API (en modo de prueba viene en el payload).
  let text = '';
  let headers: Record<string, string> = {};
  let authentication = null as ReturnType<typeof readAuthentication>;
  let messageId = typeof d.message_id === 'string' ? d.message_id : null;
  let attachments: InboundAttachment[] = [];
  if (fake && typeof d.text === 'string') {
    text = d.text;
    headers = Object.fromEntries(Object.entries((d.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    authentication = readAuthentication(d.authentication);
    attachments = (Array.isArray(d.attachments_content) ? (d.attachments_content as Array<Record<string, string>>) : []).map((a) => ({
      filename: String(a.filename ?? 'file'),
      contentType: String(a.content_type ?? 'application/octet-stream'),
      data: Buffer.from(String(a.content ?? ''), 'base64'),
    }));
  } else {
    const content = await fetchReceivedEmail(emailId);
    if (!content) return NextResponse.json({ error: 'fetch_failed' }, { status: 502 });
    text = content.text || htmlToText(content.html);
    headers = content.headers;
    authentication = content.authentication;
    messageId = content.messageId ?? messageId;
    if (content.attachments.length > 0) attachments = await fetchReceivedAttachments(emailId);
  }

  const result = await processInboundEmail(
    { emailId, from, to: recipients, subject: typeof d.subject === 'string' ? d.subject : '', text, messageId, headers, authentication, attachments },
    after,
  );
  return NextResponse.json({ ok: true, ...result });
}
