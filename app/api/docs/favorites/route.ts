import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocPageRow } from '@/lib/docs';
import {
  addDocFavorite,
  DocsFavoriteLimitError,
  listDocFavorites,
  removeDocFavorite,
  reorderDocFavorites,
} from '@/lib/docs-favorites';
import { docsError, invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().min(1).max(64);
const addSchema = z.object({ page_id: id });
const orderSchema = z.object({ ids: z.array(id).max(200) });

/** Favoritos de la persona en el workspace activo (en orden). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listDocFavorites(realUserId(user), user.id) });
}

/** Marca una página del workspace como favorita (al final de la lista). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const row = await getDocPageRow(parsed.data.page_id);
  // Solo páginas del workspace activo (no las de otro workspace compartidas).
  if (!row || row.user_id !== user.id || row.archived === 1) return notFound();
  try {
    await addDocFavorite(realUserId(user), user.id, row.id);
  } catch (err) {
    if (err instanceof DocsFavoriteLimitError) return docsError(409, 'favorite_limit');
    throw err;
  }
  return NextResponse.json({ rows: await listDocFavorites(realUserId(user), user.id) }, { status: 201 });
}

/** Quita un favorito (?page_id=). */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const pageId = req.nextUrl.searchParams.get('page_id') ?? '';
  if (!id.safeParse(pageId).success) return docsError(400, 'invalid_input');
  await removeDocFavorite(realUserId(user), pageId);
  return NextResponse.json({ rows: await listDocFavorites(realUserId(user), user.id) });
}

/** Orden nuevo (ids en el orden de la lista). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = orderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  await reorderDocFavorites(realUserId(user), user.id, parsed.data.ids);
  return NextResponse.json({ rows: await listDocFavorites(realUserId(user), user.id) });
}
