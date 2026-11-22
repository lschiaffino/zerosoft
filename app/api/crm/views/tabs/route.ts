import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getTabs, sessionViewViewer, setTabs } from '@/lib/crm-views';
import { isViewEntity } from '@/lib/crm-views-shared';
import { viewTabsSchema } from '@/lib/crm-views-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pestañas de vistas de la persona para un objeto (?entity=). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const entity = req.nextUrl.searchParams.get('entity');
  if (!isViewEntity(entity)) return crmError(400, 'invalid_input');
  return NextResponse.json({ tabs: await getTabs(await sessionViewViewer(user), entity) });
}

/** Orden, fijadas y cerradas. Las vistas que la persona no ve se descartan. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = viewTabsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const tabs = await setTabs(await sessionViewViewer(user), parsed.data.entity, parsed.data.tabs);
  return NextResponse.json({ tabs });
}
