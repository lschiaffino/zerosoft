import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listPlaybookRuns, runPlaybook } from '@/lib/crm-playbooks';
import { playbookRunSchema } from '@/lib/crm-playbooks-schema';
import { catchRef, crmError, CrmRefError, guardRecord, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Usos del playbook (los más nuevos primero). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listPlaybookRuns(user.id, { playbookId: id }) });
}

/** Usar el playbook en un registro: respuestas a propiedades y el uso al timeline. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = playbookRunSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const hidden = await guardRecord(user.id, parsed.data.entity, parsed.data.entityId, await sessionScope(user));
  if (hidden) return hidden;
  const actor = user.actingUser ?? user;
  const result = await catchRef(runPlaybook(user.id, id, parsed.data, { id: realUserId(user), email: actor.email }));
  if (result instanceof CrmRefError) return crmError(400, result.code);
  if (!result.ok) return result.reason === 'wrong_entity' ? crmError(400, 'wrong_entity') : notFound();
  return NextResponse.json({ run: result.run, activityId: result.activityId, updated: result.updated }, { status: 201 });
}
