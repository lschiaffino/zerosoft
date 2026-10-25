import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getSyncedBlock } from '@/lib/docs-synced';
import { notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contenido de un bloque sincronizado para pegarlo en otra página ("Copiar y
 * sincronizar"). Solo del workspace activo: un id de otro workspace da 404.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const blocks = await getSyncedBlock(user.id, id);
  if (!blocks) return notFound();
  return NextResponse.json({ id, blocks });
}
