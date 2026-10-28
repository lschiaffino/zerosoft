import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { canWriteAccess } from '@/lib/docs-access';
import { forbidden, notFound, unauthorized } from '@/lib/docs-http';
import { pageAnalytics, recordPageView } from '@/lib/docs-site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El editor avisa que la persona abrió la página (una vista por apertura). */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(id);
  // Solo quien la puede abrir dentro de la app (no por estar publicada).
  const access = row ? await getDocAccess(row, user, { includePublished: false }) : null;
  if (!row || !access || row.archived === 1) return notFound();
  await recordPageView(row.id, realUserId(user));
  return NextResponse.json({ ok: true });
}

/**
 * Vistas de la página (últimos 30 días): totales, personas y quién la vio.
 * Como en Notion, las ve quien puede editarla.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(id);
  const access = row ? await getDocAccess(row, user, { includePublished: false, includePublicLink: false }) : null;
  if (!row || !access) return notFound();
  if (!canWriteAccess(access)) return forbidden();
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 7), 90);
  return NextResponse.json(await pageAnalytics(row.id, { days, published: row.published === 1, workspaceId: row.user_id }));
}
