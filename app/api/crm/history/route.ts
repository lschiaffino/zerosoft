import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listPropertyEvents } from '@/lib/crm';
import { unauthorized, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES = new Set(['contact', 'company', 'deal']);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const entity = req.nextUrl.searchParams.get('entity') ?? '';
  const entityId = req.nextUrl.searchParams.get('entityId') ?? '';
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '50') || 50, 1), 200);

  if (!ENTITIES.has(entity) || !entityId) {
    return crmError(400, 'invalid_input');
  }

  const rows = await listPropertyEvents(user.id, entity as 'contact' | 'company' | 'deal', entityId, limit);
  const events = rows.map((r) => ({
    id: r.id,
    field: r.field,
    oldValue: r.field === 'company_id' ? (r.old_company_name ?? '') : r.old_value,
    newValue: r.field === 'company_id' ? (r.new_company_name ?? '') : r.new_value,
    actorEmail: r.actor_email,
    createdAt: r.created_at,
  }));

  return NextResponse.json(events);
}
