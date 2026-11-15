import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, parseBody, withFleet } from '@/lib/fleet/api';
import { deleteConnection, syncNow, updateConnection } from '@/lib/fleet/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ label: z.string().max(200).optional(), selected: z.array(z.string().max(201)).max(60).optional() });

/** PATCH: nombre de la cuenta o repos/proyectos elegidos (vuelve a sincronizar). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    const input = await parseBody(req, patchSchema);
    const connection = await updateConnection(actor, id, input);
    if (input.selected) await syncNow(actor, id).catch(() => null);
    return fJson({ connection });
  });
}

/** DELETE: desconecta la cuenta y borra lo sincronizado de ella. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return withFleet(async ({ actor }) => {
    const { id } = await ctx.params;
    await deleteConnection(actor, id);
    return fJson({ ok: true });
  });
}
