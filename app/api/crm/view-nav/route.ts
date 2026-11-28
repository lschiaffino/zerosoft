import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { crmError, unauthorized } from '@/lib/crm-http';
import { resolveMatching, type MatchingEntity } from '@/lib/crm-list-matching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES: readonly MatchingEntity[] = ['contacts', 'companies', 'deals'];
/** Registros de la vista que recorre "anterior / siguiente" en la ficha. */
const VIEW_NAV_CAP = 2000;

/**
 * Ids de los registros de una vista de contactos, empresas o deals, en su
 * orden (la query del listado: vista guardada, filtros y orden), hasta 2000.
 * Los evalúa el server con el alcance y los permisos de quien pide. La ficha
 * los usa para "anterior / siguiente" sobre la vista entera.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const entity = sp.get('entity') as MatchingEntity | null;
  if (!entity || !ENTITIES.includes(entity)) return crmError(400, 'invalid_input');
  const result = await resolveMatching(user, entity, sp.get('q') ?? '', VIEW_NAV_CAP);
  if ('error' in result) return crmError(400, result.error);
  return NextResponse.json({ ids: result.ids, total: result.total }, { headers: { 'Cache-Control': 'no-store' } });
}
