import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getDesign, listDesigns, type DesignActor, type DesignView } from '@/lib/design';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIEWS: DesignView[] = ['recent', 'mine', 'shared', 'starred', 'templates'];

/**
 * GET /api/v1/design?q=&view= : diseños que ve la persona de la key.
 * GET /api/v1/design?id=<id> : ese diseño con sus páginas (JSON).
 * Scope design:read (y la persona tiene que tener Design en el workspace).
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'design:read');
  if ('res' in auth) return auth.res;
  const actor: DesignActor = { ws: auth.user.id, personId: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin', name: '' };
  const p = new URL(req.url).searchParams;
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const id = p.get('id');
  if (id) {
    const d = await getDesign(actor, id);
    if (!d) return apiError(404, 'not_found', 'Design not found.');
    return NextResponse.json({
      data: {
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        pages: d.doc.pages,
        owner: d.ownerName,
        access: d.access,
        template: d.isTemplate,
        version: d.version,
        updated_at: d.updatedAt,
        url: `${base}/en/app/design/${d.id}`,
      },
    });
  }
  const raw = p.get('view') as DesignView | null;
  const view = raw && VIEWS.includes(raw) ? raw : 'recent';
  const rows = await listDesigns(actor, { view, q: p.get('q') ?? '', limit: 100 });
  return NextResponse.json({
    data: rows.map((d) => ({
      id: d.id,
      name: d.name,
      width: d.width,
      height: d.height,
      pages: d.pages,
      owner: d.ownerName,
      access: d.access,
      starred: d.starred,
      template: d.isTemplate,
      updated_at: d.updatedAt,
      url: `${base}/en/app/design/${d.id}`,
    })),
  });
}
