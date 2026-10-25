import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { deleteInitiative, getAccessibleInitiative, listInitiatives, updateInitiative } from '@/lib/track-initiatives';
import { initiativeUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const all = await listInitiatives(ctx.scope);
  const row = all.find((i) => i.id === id);
  if (!row) return notFound();
  return NextResponse.json({ initiative: row, children: all.filter((i) => i.parent_id === id) });
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getAccessibleInitiative(id, ctx.scope);
  if (!row) return notFound();
  const parsed = initiativeUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await updateInitiative(row, ctx.scope, parsed.data);
  return NextResponse.json((await listInitiatives(ctx.scope, { ids: [id] }))[0]);
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessibleInitiative(id, ctx.scope))) return notFound();
  await deleteInitiative(id);
  return NextResponse.json({ ok: true });
}
