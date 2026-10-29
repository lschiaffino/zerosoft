import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteFolder, renameFolder } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    await renameFolder(s.actor, id, parsed.data.name);
    return designJson({ ok: true });
  } catch (err) {
    return designFail(err);
  }
}

/** Borra la carpeta; sus diseños quedan en "Tus diseños". */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await deleteFolder(s.actor, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return designFail(err);
  }
}
