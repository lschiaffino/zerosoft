import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createDocWorkspaceTemplate, DocsTemplateLimitError, listDocWorkspaceTemplates } from '@/lib/docs';
import { docTemplateCreateSchema } from '@/lib/docs-schema';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plantillas del workspace activo. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listDocWorkspaceTemplates(user.id) });
}

/**
 * Guarda una página como plantilla del workspace. Solo páginas del propio
 * workspace (un invitado con edición en otro workspace no le crea plantillas).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docTemplateCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  let tpl;
  try {
    tpl = await createDocWorkspaceTemplate(user.id, realUserId(user), parsed.data, user);
  } catch (err) {
    if (err instanceof DocsTemplateLimitError) return docsError(409, 'template_limit');
    throw err;
  }
  if (!tpl) return docsError(404, 'not_found');
  return NextResponse.json(tpl, { status: 201 });
}
