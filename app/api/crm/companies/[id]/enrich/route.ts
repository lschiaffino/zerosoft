import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { crmError, guardRecord, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { enrichCompany } from '@/lib/crm-enrich';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Completa la empresa desde su dominio (botón "Completar desde el sitio" de
 * la ficha). Por defecto solo llena lo vacío; { overwrite: true } actualiza
 * también lo que ya tenía (salvo el nombre).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const hidden = await guardRecord(user.id, 'company', id, await sessionScope(user));
  if (hidden) return hidden;
  const limited = await limitAction(user.actingUser?.id ?? user.id, 'enrich', 60, 3600);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { overwrite?: unknown } | null;
  const res = await enrichCompany(user.id, id, {
    overwrite: body?.overwrite === true,
    actorEmail: user.actingUser?.email ?? user.email,
  });
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(400, 'no_domain');
  return NextResponse.json({ company: res.company, filled: res.filled, sources: res.sources });
}
