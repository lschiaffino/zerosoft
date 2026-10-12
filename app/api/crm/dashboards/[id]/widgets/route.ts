import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { addWidget } from '@/lib/crm-dashboards';
import { dashboardWidgetCreateSchema } from '@/lib/crm-dashboards-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dashboardWidgetCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const widget = await addWidget(user.id, params.id, parsed.data);
  if (!widget) return notFound();
  return NextResponse.json(widget, { status: 201 });
}
