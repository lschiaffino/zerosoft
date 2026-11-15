import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessibleInitiative } from '@/lib/track-initiatives';
import { createInitiativeUpdate, listInitiativeUpdates } from '@/lib/track-initiative-updates';
import { planUpdateCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Updates de la initiative, el más nuevo primero. */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessibleInitiative(id, ctx.scope))) return notFound();
  return NextResponse.json({ rows: await listInitiativeUpdates(id), me: ctx.actorId, admin: ctx.admin });
}

export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const initiative = await getAccessibleInitiative(id, ctx.scope);
  if (!initiative) return notFound();
  const parsed = planUpdateCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createInitiativeUpdate(initiative, ctx.actorId, parsed.data), { status: 201 });
}
