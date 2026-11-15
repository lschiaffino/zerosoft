import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, parseBody, withFleet } from '@/lib/fleet/api';
import { archiveSession, deleteSession, getSession, listMessages, markRead, renameSession } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: la sesión y su conversación. ?read=1 la marca leída. */
export async function GET(req: NextRequest, ctx: Ctx) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    if (new URL(req.url).searchParams.get('read') === '1') await markRead(actor, id);
    const [session, messages] = await Promise.all([getSession(actor, id), listMessages(actor, id)]);
    return fJson({ session, messages });
  });
}

const patchSchema = z.object({ title: z.string().max(400).optional(), archived: z.boolean().optional(), read: z.literal(true).optional() });

/** PATCH: renombrar, archivar o marcar leída. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    const input = await parseBody(req, patchSchema);
    if (input.title !== undefined) await renameSession(actor, id, input.title);
    if (input.archived !== undefined) await archiveSession(actor, id, input.archived);
    if (input.read) await markRead(actor, id);
    return fJson({ session: await getSession(actor, id) });
  });
}

/** DELETE: borra la sesión y su conversación de Fleet (no toca al agente). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    await deleteSession(actor, id);
    return fJson({ ok: true });
  });
}
