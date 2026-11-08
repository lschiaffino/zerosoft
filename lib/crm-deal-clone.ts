/**
 * CRM — clonar un deal (puro, sin DB: lo usan el server y el cliente).
 * Arma el cuerpo de POST /api/crm/deals a partir de un deal existente: copia
 * monto, moneda, fecha, prioridad, fuente, descripción, campos propios y
 * asociaciones. No copia motivo de pérdida, historial, notas, tareas ni
 * line items. Un deal ganado o perdido arranca en la primera etapa abierta.
 */
export const CLONE_NAME_MAX = 500;

export interface CloneSourceDeal {
  pipeline_id: string;
  stage_id: string;
  name: string;
  amount: number;
  currency: string;
  close_date: string | null;
  priority: string;
  source: string;
  description: string;
  owner_id: string | null;
  custom: string;
}

export interface CloneStage {
  id: string;
  is_won: number | boolean;
  is_lost: number | boolean;
}

export function cloneName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  const base = name.trim();
  if (base.endsWith(tail)) return base.slice(0, CLONE_NAME_MAX);
  return `${base.slice(0, CLONE_NAME_MAX - tail.length)}${tail}`;
}

/** Etapa donde arranca el clon: la misma si está abierta, si no la primera abierta (stages en orden). */
export function cloneStageId(stages: CloneStage[], currentId: string): string | null {
  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  if (open.some((s) => s.id === currentId)) return currentId;
  return open[0]?.id ?? null;
}

function parseCustom(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildDealCloneBody(
  deal: CloneSourceDeal,
  stages: CloneStage[],
  links: { contactIds: string[]; companyId: string | null; companyIds: string[] },
  suffix: string,
): Record<string, unknown> | null {
  const stageId = cloneStageId(stages, deal.stage_id);
  if (!stageId) return null;
  const body: Record<string, unknown> = {
    pipelineId: deal.pipeline_id,
    stageId,
    name: cloneName(deal.name, suffix),
    amount: deal.amount,
    currency: deal.currency,
    priority: deal.priority,
    source: deal.source,
    description: deal.description,
    custom: parseCustom(deal.custom),
    contactIds: links.contactIds,
    companyIds: links.companyIds.filter((id) => id !== links.companyId),
  };
  if (deal.close_date) body.closeDate = deal.close_date.slice(0, 10);
  if (links.companyId) body.companyId = links.companyId;
  if (deal.owner_id) body.ownerId = deal.owner_id;
  return body;
}
