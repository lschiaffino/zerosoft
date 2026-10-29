import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getDesign,
  markOpened,
  moveDesign,
  purgeDesign,
  renameDesign,
  restoreDesign,
  saveDesignDoc,
  setStar,
  trashDesign,
} from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El diseño con su JSON. ?embed=1: solo nombre, tamaño y miniatura (bloque de Docs). ?open=1 lo marca como abierto. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const d = await getDesign(s.actor, id);
  if (!d) return designJson({ error: 'not_found' }, 404);
  if (req.nextUrl.searchParams.get('embed') === '1') {
    return designJson({ design: { id: d.id, name: d.name, width: d.width, height: d.height, pages: d.pages, thumb: d.thumb } });
  }
  if (req.nextUrl.searchParams.get('open') === '1') await markOpened(s.actor, id);
  return designJson({ design: d });
}

const patchSchema = z
  .object({
    name: z.string().max(120),
    folderId: z.string().max(64).nullable(),
    starred: z.boolean(),
    restore: z.literal(true),
    doc: z.unknown(),
    version: z.number().int().min(0),
    thumb: z.string().max(400_000).nullable(),
  })
  .partial();

/** Renombrar, mover, favorito, restaurar de la papelera o guardar el JSON (con `version`). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  const p = parsed.data;
  try {
    if (p.restore) await restoreDesign(s.actor, id);
    if (p.name !== undefined) await renameDesign(s.actor, id, p.name);
    if (p.folderId !== undefined) await moveDesign(s.actor, id, p.folderId);
    if (p.starred !== undefined) await setStar(s.actor, id, p.starred);
    if (p.doc !== undefined) {
      if (p.version === undefined) return designJson({ error: 'invalid_input' }, 400);
      const res = await saveDesignDoc(s.actor, id, p.doc, p.version, p.thumb);
      if (!res.ok) return designJson({ error: 'conflict', version: res.version, updatedByName: res.updatedByName }, 409);
      return designJson({ version: res.version, updatedAt: res.updatedAt });
    }
    return designJson({ ok: true });
  } catch (err) {
    return designFail(err);
  }
}

/** A la papelera; ?forever=1 la borra de la papelera para siempre. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    if (req.nextUrl.searchParams.get('forever') === '1') await purgeDesign(s.actor, id);
    else await trashDesign(s.actor, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return designFail(err);
  }
}
