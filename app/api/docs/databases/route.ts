import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listWorkspaceDatabases } from '@/lib/docs-db-server';
import { unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bases de datos de las páginas del workspace (selector de relación, de
 * vista vinculada y de "agregar fila en otra base"). Solo las del workspace
 * activo: una página compartida desde otro workspace no aparece.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100);
  return NextResponse.json({ rows: await listWorkspaceDatabases(user.id, q) });
}
