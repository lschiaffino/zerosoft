import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessibleInitiative } from '@/lib/track-initiatives';
import { deleteInitiativeUpdate, editInitiativeUpdate, getInitiativeUpdate } from '@/lib/track-initiative-updates';
import { planUpdateEditSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Solo el autor edita su update; lo borra el autor o un admin del workspace. */
async function own(id: string, action: 'edit' | 'delete') {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const update = await getInitiativeUpdate(id);
  if (!update || !(await getAccessibleInitiative(update.initiative_id, ctx.scope))) return { error: notFound() } as const;
  const mine = update.user_id === ctx.actorId;
  if (!mine && !(action === 'delete' && ctx.admin)) return { error: trackError(403, 'forbidden') } as const;
  return { ctx, update } as const;
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await own(id, 'edit');
  if ('error' in r) return r.error;
  const parsed = planUpdateEditSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await editInitiativeUpdate(id, parsed.data);
  return NextResponse.json(await getInitiativeUpdate(id));
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await own(id, 'delete');
  if ('error' in r) return r.error;
  await deleteInitiativeUpdate(id);
  return NextResponse.json({ ok: true });
}
