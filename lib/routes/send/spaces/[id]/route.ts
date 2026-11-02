import { NextRequest } from 'next/server';
import { z } from 'zod';
import { canEditSpace, deleteSpace, getSpace, listSpaceAccess, setSpaceItems, spaceItems, updateSpace } from '@/lib/send/spaces';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    return sJson({ space: { id: s.id, title: s.title, description: s.description, sharing: s.sharing, canEdit: canEditSpace(a.actor, s) }, items: await spaceItems(a.actor, s.id), access: await listSpaceAccess(a.actor, s.id) });
  } catch (err) {
    return sFail(err);
  }
}

const schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  sharing: z.enum(['private', 'workspace']).optional(),
  items: z.array(z.object({ documentId: z.string().max(40), folder: z.string().max(80).optional() })).max(2000).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const { items, ...patch } = await parseBody(req, schema);
    const s = await updateSpace(a.actor, id, patch);
    const list = items ? await setSpaceItems(a.actor, id, items) : await spaceItems(a.actor, id);
    return sJson({ space: { id: s.id, title: s.title, description: s.description, sharing: s.sharing }, items: list });
  } catch (err) {
    return sFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    await deleteSpace(a.actor, (await ctx.params).id);
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}
