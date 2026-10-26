import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { personCanViewBoard } from '@/lib/board-access';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vista previa de una pizarra para el bloque /board de Docs: nombre,
 * miniatura y fecha. Solo si la persona que mira la página puede ver la
 * pizarra (es de su workspace y, si está restringida, está invitada); si no,
 * 404 y el bloque muestra "sin acceso" sin revelar nada.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  if (!(await personCanViewBoard(personId, id))) return jsonError(404, 'not_found');
  const row = (await getDb()
    .prepare('SELECT id, name, thumbnail, updated_at FROM boards WHERE id = ?')
    .get(id)) as { id: string; name: string; thumbnail: string | null; updated_at: string } | undefined;
  if (!row) return jsonError(404, 'not_found');
  return NextResponse.json(row, { headers: { 'Cache-Control': 'private, no-store' } });
}
