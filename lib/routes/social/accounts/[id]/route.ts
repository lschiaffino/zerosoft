import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { disconnectAccount, getAccount, renameAccount, setAccountMembers } from '@/lib/social';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(async ({ actor }) => NextResponse.json(await getAccount(actor, id)));
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  memberIds: z.array(z.string().max(64)).max(200).optional(),
});

/** Admins: renombrar la cuenta y elegir quién publica en ella. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, patchSchema);
      if (!body) return jsonError(400, 'invalid_input');
      let account = await getAccount(actor, id);
      if (body.name !== undefined) account = await renameAccount(actor, id, body.name);
      if (body.memberIds) account = await setAccountMembers(actor, id, body.memberIds);
      return NextResponse.json(account);
    },
    { write: 'accounts', limit: 60 },
  );
}

/** Admins: desconectar (se borran los tokens; lo pendiente para esa cuenta falla). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      await disconnectAccount(actor, id);
      return NextResponse.json({ ok: true });
    },
    { write: 'accounts', limit: 60 },
  );
}
