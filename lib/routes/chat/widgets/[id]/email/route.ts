import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessWidget } from '@/lib/chat-access';
import { getChatWidget } from '@/lib/chat-data';
import { inboundAddress, inboundFake } from '@/lib/chat-email';

export const dynamic = 'force-dynamic';

/**
 * Canal email del widget: la dirección a la que se reenvía el soporte@ del
 * sitio. enabled = el servidor tiene CHAT_INBOUND_DOMAIN y la firma del
 * webhook (o el modo de prueba).
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const address = inboundAddress('inbox', id);
  const signed = !!process.env.RESEND_WEBHOOK_SECRET?.trim() || inboundFake();
  return NextResponse.json({ enabled: !!address && signed, address, webhookPath: '/api/chat/inbound-email' });
}
