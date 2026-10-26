import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getSyncedBlock } from '@/lib/docs-synced';
import { notFound, unauthorized } from '@/lib/docs-http';
import { canReadSynced } from '@/lib/docs-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Contenido de un bloque sincronizado para pegarlo en otra página ("Copiar y
 * sincronizar"). Solo del workspace activo: un id de otro workspace da 404.
 * Además hay que poder abrir la página de origen (o alguna que lo contenga):
 * un bloque de un teamspace privado no se copia sabiendo el id.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canReadSynced(user, id))) return notFound();
  const blocks = await getSyncedBlock(user.id, id);
  if (!blocks) return notFound();
  return NextResponse.json({ id, blocks });
}
