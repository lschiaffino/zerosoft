import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { fetchReceivedEmail, htmlToText, inboundFake, processInboundEmail, verifySvixSignature } from '@/lib/chat-email';

export const dynamic = 'force-dynamic';

/**
 * Webhook de Resend (evento email.received): un email a reply+… o inbox+…
 * entra a la conversación. Firma Svix con RESEND_WEBHOOK_SECRET; sin secreto
 * (y fuera del modo de prueba CHAT_INBOUND_FAKE) responde 503. Siempre 200
 * a un email que no es para nosotros, así Resend no reintenta.
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
  const to = Array.isArray(d.to) ? d.to.filter((x): x is string => typeof x === 'string') : [];
  const cc = Array.isArray(d.cc) ? d.cc.filter((x): x is string => typeof x === 'string') : [];
  if (!emailId || !from || to.length === 0) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // El webhook trae solo metadatos: el texto se pide a la API (en modo de prueba viene en el payload).
  let text = '';
  if (fake && typeof d.text === 'string') {
    text = d.text;
  } else {
    const content = await fetchReceivedEmail(emailId);
    if (!content) return NextResponse.json({ error: 'fetch_failed' }, { status: 502 });
    text = content.text || htmlToText(content.html);
  }

  const result = await processInboundEmail(
    { emailId, from, to: [...to, ...cc], subject: typeof d.subject === 'string' ? d.subject : '', text },
    after,
  );
  return NextResponse.json({ ok: true, ...result });
}
