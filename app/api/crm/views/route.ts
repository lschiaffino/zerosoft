import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createView, listViews, sessionViewViewer } from '@/lib/crm-views';
import { isViewEntity, VIEW_VISIBILITIES, type ViewVisibility } from '@/lib/crm-views-shared';
import { viewCreateSchema } from '@/lib/crm-views-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vistas guardadas que la persona ve (las privadas de otros no existen para
 * ella). ?entity=contacts|companies|deals, ?q= (nombre), ?createdBy=<persona>,
 * ?shared=mine|private|team|everyone.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const entity = sp.get('entity');
  if (entity && !isViewEntity(entity)) return crmError(400, 'invalid_input');
  const shared = sp.get('shared') ?? '';
  const viewer = await sessionViewViewer(user);
  const rows = await listViews(viewer, {
    entity: isViewEntity(entity) ? entity : undefined,
    q: sp.get('q')?.slice(0, 200) || undefined,
    createdBy: sp.get('createdBy') || undefined,
    shared: shared === 'mine' || (VIEW_VISIBILITIES as readonly string[]).includes(shared) ? (shared as 'mine' | ViewVisibility) : undefined,
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = viewCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createView(await sessionViewViewer(user), parsed.data);
  if (!res.ok) return crmError(res.error === 'too_many' ? 409 : 400, res.error);
  return NextResponse.json(res.view, { status: 201 });
}
