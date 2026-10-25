import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { canSeeDashboard, deleteWidget, getWidget, updateWidget } from '@/lib/track-dashboards';
import { widgetUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const widget = await getWidget(id);
  if (!widget || !canSeeDashboard(widget.dashboard, ctx.scope, ctx.actorId)) return { error: notFound() } as const;
  return { ctx, widget } as const;
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  const parsed = widgetUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await updateWidget(r.widget, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  await deleteWidget(id);
  return NextResponse.json({ ok: true });
}
