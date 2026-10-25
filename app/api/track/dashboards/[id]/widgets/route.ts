import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { addWidget, getVisibleDashboard } from '@/lib/track-dashboards';
import { widgetCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Suma un insight al dashboard ("Add to dashboard"). */
export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getVisibleDashboard(id, ctx.scope, ctx.actorId))) return notFound();
  const parsed = widgetCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ id: await addWidget(id, parsed.data) }, { status: 201 });
}
