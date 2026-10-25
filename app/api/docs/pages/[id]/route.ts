import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { DocsConflictError, deleteDocPage, getDocAccess, getDocPageRow, listEffectiveDocShares, toDocPage, updateDocPage } from '@/lib/docs';
import { stripFileUrls } from '@/lib/docs-files';
import { SHARED_EDITABLE_FIELDS, docPageUpdateSchema } from '@/lib/docs-schema';
import { maybeAutoSnapshot } from '@/lib/docs-versions';
import { runDbEffects } from '@/lib/docs-db-server';
import type { DbEffect } from '@/lib/docs-db-save';
import { notFound, unauthorized, invalidBody, forbidden, docsError } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  // Los shares (quién tiene acceso, propios y heredados) solo los ve el dueño.
  const shares = access === 'owner' ? await listEffectiveDocShares(row) : [];
  const page = toDocPage(row);
  // Solo lectura: la URL del storage de imágenes/archivos no viaja (se sirven por /api/docs/files).
  if (access === 'view') page.content = stripFileUrls(page.content);
  return NextResponse.json({ ...page, access, shares });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (access === 'view') return forbidden();

  const patch = parsed.data;
  if (access === 'edit') {
    // Un invitado con edición cambia el contenido, nunca la publicación, la
    // IA, el árbol ni la papelera del workspace ajeno.
    const allowed = new Set<string>(SHARED_EDITABLE_FIELDS);
    if (Object.keys(patch).some((k) => !allowed.has(k))) return forbidden();
  }

  let page;
  // Automatizaciones de las bases que disparó este guardado (corren después de responder).
  const effects: DbEffect[] = [];
  try {
    page = await updateDocPage(row.user_id, params.id, patch, { actorId: realUserId(user), effects });
  } catch (err) {
    // Otra persona guardó (o se restauró una versión) desde que el editor
    // cargó la página: no pisar su contenido en silencio.
    if (err instanceof DocsConflictError) return docsError(409, 'conflict');
    throw err;
  }
  if (!page) return notFound();
  if (effects.length) {
    const actor = { ...user, realId: realUserId(user) };
    after(() => runDbEffects(effects, actor).catch(() => {}));
  }
  if (patch.content !== undefined || patch.title !== undefined) {
    await maybeAutoSnapshot(row.user_id, params.id, realUserId(user), row).catch(() => {});
  }
  return NextResponse.json(page);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar para siempre (subárbol, versiones y comentarios) es irreversible:
  // solo admins, como en Track y Chat. Un member puede mandar a la papelera.
  if (!isWorkspaceAdmin(user)) return forbidden();
  if (!(await deleteDocPage(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
