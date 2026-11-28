import { NextResponse } from 'next/server';
import { deleteRecurring, getRecurring, recurringRuns, updateRecurring, type RecurringPatch } from '@/lib/groups-recurring';
import { unmaskEdit, visibleChatIds } from '@/lib/groups-access';
import { maskBroadcast } from '@/lib/groups-broadcasts';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr, type GroupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * La serie, si la persona ve alguno de sus chats (acceso por etiqueta y por línea), con solo
 * los chats que ve. `all`: además todos sus chats tienen que ser visibles (para cambiarla o
 * borrarla, como un envío programado).
 */
async function visible(s: GroupsSession, id: string, opts: { all?: boolean } = {}) {
  const rec = await getRecurring(s.ws, id);
  if (!rec) return null;
  const viewer = await sessionViewer(s);
  const ids = await visibleChatIds(viewer);
  // `raw`: lo guardado (para comparar al editar); `rec`: lo que se muestra, con los teléfonos ocultos si hace falta.
  if (!ids) return { rec: maskBroadcast(viewer.mask, rec), raw: rec, ids, mask: viewer.mask };
  if (opts.all ? !rec.chatIds.every((c) => ids.has(c)) : !rec.chatIds.some((c) => ids.has(c))) return null;
  return { rec: maskBroadcast(viewer.mask, { ...rec, chatIds: rec.chatIds.filter((c) => ids.has(c)) }), raw: rec, ids, mask: viewer.mask };
}

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const found = await visible(s, id);
  if (!found) return groupsError(404, 'not_found');
  return NextResponse.json({ recurring: found.rec, runs: await recurringRuns(s.ws, id) });
}

/** Editar (texto, encuesta, destinos, regla, zona, fin, ritmo, nombre) o pausar y reanudar ({ status }). */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const found = await visible(s, id, { all: true });
  if (!found) return groupsError(404, 'not_found');
  const b = await readJson(req);
  const patch: RecurringPatch = {};
  // Con los teléfonos ocultos, el nombre y el texto llegaron enmascarados: los números guardados no se pierden.
  if (typeof b.name === 'string') patch.name = found.mask ? unmaskEdit(found.raw.name, b.name) : b.name;
  if (typeof b.body === 'string') patch.body = found.mask ? unmaskEdit(found.raw.body, b.body) : b.body;
  if (b.poll !== undefined) patch.poll = b.poll;
  // Solo chats que la persona ve.
  if (Array.isArray(b.chatIds)) patch.chatIds = strArr(b.chatIds, 2000).filter((c) => !found.ids || found.ids.has(c));
  if (b.rule !== undefined) patch.rule = b.rule;
  if (typeof b.timezone === 'string') patch.timezone = b.timezone;
  if (b.endsAt === null || typeof b.endsAt === 'string') patch.endsAt = str(b.endsAt, 40) || null;
  if (b.perMinute !== undefined) patch.perMinute = Number(b.perMinute) || 20;
  if (b.status === 'active' || b.status === 'paused') patch.status = b.status;
  try {
    return NextResponse.json(maskBroadcast(found.mask, await updateRecurring(s.ws, id, patch)));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  if (!(await visible(s, id, { all: true }))) return groupsError(404, 'not_found');
  return (await deleteRecurring(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
