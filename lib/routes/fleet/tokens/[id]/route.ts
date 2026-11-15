import { NextRequest } from 'next/server';
import { fJson, withFleet } from '@/lib/fleet/api';
import { deleteToken, listTokens } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE: revoca un token: el hook que lo usa deja de mandar al instante. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    await deleteToken(actor, id);
    return fJson({ tokens: await listTokens(actor) });
  });
}
