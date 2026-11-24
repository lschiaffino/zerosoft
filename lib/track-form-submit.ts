/**
 * Track — responder un formulario de pedidos (lib/track-forms.ts): valida las
 * respuestas contra los campos de la plantilla y crea el issue con las
 * propiedades de la plantilla. Entra a triage si el team lo tiene prendido
 * (origen 'form', como los pedidos de la API o Slack); si no, al estado de la
 * plantilla o al default del team.
 */
import type { TrackIssueTemplateRow, TrackProjectRow } from './db';
import { validateIssueRefs } from './track-bulk';
import { createIssue, type TrackIssueWithStatus } from './track-data';
import { composeFormDescription, parseFormFields, validateFormAnswers, type FormAnswerError } from './track-forms';
import type { IssueCreatePayload, TemplateSubmitPayload } from './track-schema';

function templateLabels(raw: string): Array<{ id: string }> {
  try {
    const list = JSON.parse(raw) as Array<{ id?: unknown }>;
    return Array.isArray(list) ? list.filter((l) => typeof l?.id === 'string').map((l) => ({ id: l.id as string })).slice(0, 10) : [];
  } catch {
    return [];
  }
}

export async function submitFormTemplate(args: {
  template: TrackIssueTemplateRow;
  project: TrackProjectRow;
  creatorId: string;
  ownerId: string;
  payload: TemplateSubmitPayload;
}): Promise<{ ok: true; issue: TrackIssueWithStatus } | { ok: false; error: 'not_a_form' | 'invalid_answers'; fields?: FormAnswerError[] }> {
  const { template, project, creatorId, ownerId, payload } = args;
  const fields = parseFormFields(template.fields);
  if (fields.length === 0) return { ok: false, error: 'not_a_form' };
  const checked = validateFormAnswers(fields, payload.answers);
  if (!checked.ok) return { ok: false, error: 'invalid_answers', fields: checked.errors };

  const issue: IssueCreatePayload = {
    title: payload.title.trim().slice(0, 500),
    description: composeFormDescription(fields, checked.values, { details: payload.details }),
    statusId: template.status_id,
    priority: template.priority ?? undefined,
    assigneeId: template.assignee_id,
    estimate: template.estimate,
    labels: templateLabels(template.labels),
  };
  // La plantilla pudo quedar vieja (un estado borrado, alguien que ya no está
  // en el team): esas propiedades se dejan sin poner en vez de perder el pedido.
  if (await validateIssueRefs(project, { statusId: issue.statusId, assigneeId: issue.assigneeId }, { ownerId })) {
    if (await validateIssueRefs(project, { statusId: issue.statusId }, { ownerId })) issue.statusId = null;
    if (await validateIssueRefs(project, { assigneeId: issue.assigneeId }, { ownerId })) issue.assigneeId = null;
  }
  const created = await createIssue(project.id, creatorId, issue, { source: 'form' });
  return { ok: true, issue: created };
}
