import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeEntity, canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { getRecord, linkRecord, recordLinks, unlinkRecord } from '@/lib/crm-objects';
import { objectLinkSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import type { SessionUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El registro y el contacto/empresa/deal tienen que verse los dos. */
async function guard(user: SessionUser, id: string, entity?: 'contact' | 'company' | 'deal', entityId?: string) {
  const scope = await sessionScope(user);
  const record = await getRecord(user.id, id);
  if (!record || !canSeeOwner(scope, record.owner_id, user.id)) return false;
  if (entity && entityId && !(await canSeeEntity(user.id, entity, entityId, scope))) return false;
  return true;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await guard(user, id))) return notFound();
  return NextResponse.json(await recordLinks(user.id, id));
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = objectLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await guard(user, id, parsed.data.entity, parsed.data.entityId))) return notFound();
  const ok = await catchRef(linkRecord(user.id, id, parsed.data.entity, parsed.data.entityId));
  if (ok instanceof CrmRefError) return crmError(400, ok.code);
  return ok ? NextResponse.json({ ok: true }, { status: 201 }) : notFound();
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = objectLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await guard(user, id, parsed.data.entity, parsed.data.entityId))) return notFound();
  await unlinkRecord(user.id, id, parsed.data.entity, parsed.data.entityId);
  return new NextResponse(null, { status: 204 });
}
