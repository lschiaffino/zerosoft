import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { getSessionRow } from '@/lib/voice';
import { contactLabel, linkBooking } from '@/lib/voice-integrations';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vincula una reserva de Cal (y su contacto del CRM por el email del invitado). Body: { bookingId }. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.slice(0, 64) : '';
  if (!bookingId) return voiceJsonError(400, 'invalid_input');
  const row = await getSessionRow(auth.owner, id);
  if (!row) return voiceJsonError(404, 'not_found');
  try {
    const res = await linkBooking({ owner: auth.owner, scope: await sessionScope(auth.user), sessionId: id, bookingId, currentTitle: row.title });
    if (!res.ok) return voiceJsonError(404, 'booking_not_found');
    return NextResponse.json({ ...res, contact: await contactLabel(auth.owner.workspaceId, res.contactId) });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
