import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { inviteMembers, joinChannel, listChannelMembers, removeMember } from '@/lib/talk';

type Ctx = { params: Promise<{ id: string }> };

const addSchema = z.object({ userIds: z.array(z.string().max(64)).max(200).optional(), join: z.boolean().optional() });

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json({ members: await listChannelMembers(actor, id) }));
}

/** { join: true } me suma a un canal público; { userIds } invita personas. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, addSchema);
      if (!body) return jsonError(400, 'invalid_input');
      if (body.join) return NextResponse.json(await joinChannel(actor, id));
      if (!body.userIds?.length) return jsonError(400, 'invalid_input');
      return NextResponse.json(await inviteMembers(actor, id, body.userIds));
    },
    { write: 'members', limit: 120 },
  );
}

/** ?userId= saca a esa persona; sin userId, salgo yo (o cierro el DM). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      await removeMember(actor, id, req.nextUrl.searchParams.get('userId') || actor.personId);
      return NextResponse.json({ ok: true });
    },
    { write: 'members', limit: 120 },
  );
}
