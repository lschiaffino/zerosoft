import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { defaultSenderFor, enrollContacts } from '@/lib/crm-sequences';
import { enrollSchema } from '@/lib/crm-email-schema';
import { zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  not_found: 'Sequence not found.',
  gmail_not_connected: 'The sender has no Gmail account connected with send permission.',
  no_steps: 'The sequence has no steps.',
  invalid_sender: 'senderId is not a member of this workspace.',
};

/**
 * Inscribe contactos. senderId (opcional) = persona del workspace cuyo Gmail
 * envía; por defecto el owner del primer contacto o quien creó la secuencia.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  const body: unknown = await req.json().catch(() => null);
  const parsed = enrollSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const senderId = parsed.data.senderId ?? (await defaultSenderFor(auth.user.id, id, parsed.data.contactIds[0]));
  const res = await enrollContacts(auth.user.id, {
    sequenceId: id,
    contactIds: parsed.data.contactIds,
    senderId,
    enrolledBy: null,
  });
  if (!res.ok) return apiError(res.error === 'not_found' ? 404 : 400, res.error, MESSAGES[res.error] ?? res.error);
  return NextResponse.json({ enrolled: res.enrolled, skipped: res.skipped }, { status: 201 });
}
