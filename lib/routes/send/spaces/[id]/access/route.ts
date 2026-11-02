import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSpace, listSpaceAccess, removeSpaceAccess, setSpaceAccess } from '@/lib/send/spaces';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ email: z.string().max(254), documentIds: z.array(z.string().max(40)).max(2000) });

/** PUT: qué documentos ve una persona. Sin fila, ve lo que muestra el link. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    const input = await parseBody(req, schema);
    await setSpaceAccess(a.actor, s.id, input.email, input.documentIds);
    return sJson({ access: await listSpaceAccess(s.id) });
  } catch (err) {
    return sFail(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    await removeSpaceAccess(a.actor, s.id, req.nextUrl.searchParams.get('email') ?? '');
    return sJson({ access: await listSpaceAccess(s.id) });
  } catch (err) {
    return sFail(err);
  }
}
