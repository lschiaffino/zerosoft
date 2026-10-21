import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createProject, listProjectMetas, listProjects } from '@/lib/track-data';
import { projectCreateSchema } from '@/lib/track-schema';
import { invalidBody, pageParams, unauthorized } from '@/lib/track-http';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  // ?meta=1 → proyectos activos con statuses y miembros (quick-create global de Track).
  if (sp.get('meta') === '1') {
    return NextResponse.json({ rows: await listProjectMetas(user.team?.id ?? null, user.id) });
  }
  const { page, pageSize } = pageParams(sp);
  const result = await listProjects(user.team?.id ?? null, user.id, { page, pageSize });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // Los estados por defecto nacen en el idioma de la UI de quien crea el proyecto.
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const project = await createProject(user.id, user.team?.id ?? null, parsed.data, { locale });
  return NextResponse.json(project, { status: 201 });
}
