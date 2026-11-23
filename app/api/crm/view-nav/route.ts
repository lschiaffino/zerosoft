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
 * Anterior / siguiente en la ficha, como en HubSpot: los ids de la vista de
 * la que se abrió el registro (la query del listado, con su vista guardada,
 * filtros y orden), en ese orden. Los evalúa el server con el alcance y los
 * permisos de quien pide (lib/crm-list-matching.ts), con tope.
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
