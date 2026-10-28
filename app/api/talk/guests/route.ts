import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { inviteGuest, listGuests, removeGuest, revokeGuestInvite } from '@/lib/talk-guests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Invitados y sus canales, e invitaciones pendientes (admins). */
export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json(await listGuests(actor)));
}

const schema = z.object({ email: z.string().max(254), channelIds: z.array(z.string().max(64)).min(1).max(20), locale: z.string().max(5).optional() });

/** Invitar un email a uno o más canales. */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor, user }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const inviter = user.actingUser ?? user;
      const res = await inviteGuest(actor, { ...body, inviterName: inviter.name ?? inviter.email });
      // El token solo viaja por email (en la respuesta, nunca).
      return NextResponse.json(res.kind === 'invited' ? { kind: res.kind, invite: res.invite, emailed: res.emailed } : res, { status: 201 });
    },
    { write: 'guests', limit: 60 },
  );
}

/** ?userId= saca a un invitado (pierde todo al instante); ?inviteId= revoca una invitación. */
export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return withTalk(
    async ({ actor }) => {
      const userId = sp.get('userId');
      const inviteId = sp.get('inviteId');
      if (userId) return NextResponse.json({ ok: await removeGuest(actor, userId) });
      if (inviteId) return NextResponse.json({ ok: await revokeGuestInvite(actor, inviteId) });
      return jsonError(400, 'invalid_input');
    },
    { write: 'guests', limit: 60 },
  );
}
