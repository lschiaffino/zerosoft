import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listPropertyEvents } from '@/lib/crm';
import { unauthorized, crmError, guardRecord } from '@/lib/crm-http';
import { canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { hiddenFieldsFor, sessionFieldViewer } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES = new Set(['contact', 'company', 'deal']);
const FIELD_ENTITY = { contact: 'contacts', company: 'companies', deal: 'deals' } as const;

/**
 * Historial de propiedades de un registro. Con los mismos permisos que la
 * ficha: un registro que la persona no ve da 404, los campos propios que tiene
 * ocultos no aparecen, y el nombre de una empresa vinculada que no ve queda
 * vacío (el cambio se ve, el nombre no).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const entity = req.nextUrl.searchParams.get('entity') ?? '';
  const entityId = req.nextUrl.searchParams.get('entityId') ?? '';
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '50') || 50, 1), 200);

  if (!ENTITIES.has(entity) || !entityId) {
    return crmError(400, 'invalid_input');
  }
  const kind = entity as 'contact' | 'company' | 'deal';
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, kind, entityId, scope);
  if (hidden) return hidden;
  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), FIELD_ENTITY[kind]);

  const rows = (await listPropertyEvents(user.id, kind, entityId, limit)).filter(
    (r) => !(r.field.startsWith('custom.') && hiddenFields.has(r.field.slice(7))),
  );
  const companyName = async (id: string, name: string | null): Promise<string> =>
    name && (await canSeeEntity(user.id, 'company', id, scope)) ? name : '';
  const events = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      field: r.field,
      oldValue: r.field === 'company_id' ? await companyName(r.old_value, r.old_company_name) : r.old_value,
      newValue: r.field === 'company_id' ? await companyName(r.new_value, r.new_company_name) : r.new_value,
      actorEmail: r.actor_email,
      createdAt: r.created_at,
    })),
  );

  return NextResponse.json(events);
}
