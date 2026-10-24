import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDb, type CrmStageRow } from '@/lib/db';
import { dealMissingForStage, getDeal } from '@/lib/crm';
import { describeMissing, moveDealWithFields } from '@/lib/crm-stage-move';
import { checkApproval, getApproval } from '@/lib/crm-approvals';
import { dealMoveSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';

import { listMembers } from '@/lib/teams';
import type { SessionUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function peopleOptions(user: SessionUser): Promise<Array<{ value: string; label: string }>> {
  const members = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  return members.map((m) => ({ value: m.user_id, label: m.name || m.email }));
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', params.id, scope);
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealMoveSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { stageId, lostReason } = parsed.data;

  const detail = await getDeal(user.id, params.id);
  if (!detail) return notFound();

  // El stage destino tiene que pertenecer al pipeline del deal.
  const stage = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
    .get(stageId, detail.deal.pipeline_id)) as CrmStageRow | undefined;
  if (!stage) return crmError(400, 'invalid_stage');

  // Pregunta previa de la UI (p. ej. antes del diálogo de ganado): qué pediría
  // la etapa, sin mover. Responde 200 para que el caso esperado no sea un error.
  if (parsed.data.dryRun) {
    const missing = detail.deal.stage_id === stageId ? [] : await dealMissingForStage(user.id, detail.deal, stage);
    const check = detail.deal.stage_id === stageId ? null : await checkApproval(user.id, detail.deal, stageId, user.actingUser?.id ?? user.id);
    let approval: Record<string, unknown> | null = null;
    if (check?.needed) {
      const people = await peopleOptions(user);
      const name = (pid: string) => people.find((p) => p.value === pid)?.label ?? '';
      const pending = check.pending ? await getApproval(user.id, check.pending.id) : null;
      approval = {
        stage: stage.name,
        stageId: stage.id,
        approvers: check.approverIds.map((pid) => ({ id: pid, name: name(pid) })),
        pending: pending
          ? { id: pending.id, created_at: pending.created_at, requested_by: pending.requested_by, requested_by_name: name(pending.requested_by ?? ''), note: pending.note }
          : null,
      };
    }
    return NextResponse.json({
      stage: stage.name,
      closeDate: detail.deal.close_date ?? null,
      approval,
      missing: missing.length
        ? await describeMissing(user.id, missing, missing.includes('ownerId') || missing.some((k) => k.startsWith('custom:')) ? await peopleOptions(user) : [])
        : [],
    });
  }

  // Cerrar como perdido exige motivo (en el payload o ya cargado en el deal).
  if (stage.is_lost && lostReason === undefined && !detail.deal.lost_reason) {
    return crmError(400, 'missing_lost_reason');
  }

  const result = await catchRef(
    moveDealWithFields(user.id, params.id, parsed.data, user.actingUser?.email ?? user.email, user.actingUser?.id ?? user.id),
  );
  if (result instanceof CrmRefError) return crmError(400, result.code);
  if (!result.ok) {
    if (result.reason === 'missing_required') {
      // La etapa pide propiedades: la UI abre el diálogo para completarlas.
      return NextResponse.json(
        {
          error: 'missing_required',
          stage: stage.name,
          missing: await describeMissing(user.id, result.missing, await peopleOptions(user)),
        },
        { status: 422 },
      );
    }
    if (result.reason === 'approval_required') {
      // La etapa pide aprobación: la UI ofrece pedirla (o muestra el pedido abierto).
      const people = await peopleOptions(user);
      const name = (id: string) => people.find((p) => p.value === id)?.label ?? '';
      const pending = result.pendingId ? await getApproval(user.id, result.pendingId) : null;
      return NextResponse.json(
        {
          error: 'approval_required',
          stage: stage.name,
          stageId: stage.id,
          approvers: result.approverIds.map((id) => ({ id, name: name(id) })),
          pending: pending
            ? { id: pending.id, created_at: pending.created_at, requested_by: pending.requested_by, requested_by_name: name(pending.requested_by ?? ''), note: pending.note }
            : null,
        },
        { status: 409 },
      );
    }
    return result.reason === 'not_found' ? notFound() : crmError(400, 'invalid_stage');
  }
  return NextResponse.json(result.deal);
}
