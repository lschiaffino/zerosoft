import { listLists, listPipelinesWithStages } from './crm';
import { listSequences } from './crm-sequences';
import { listForms } from './crm-forms';
import { listFlows } from './flow';
import { listMembers } from './teams';
import type { SessionUser } from './session';

/** Todo lo que el editor de workflows necesita para sus selects, en paralelo. */
export async function loadWorkflowEditorData(user: SessionUser) {
  const [lists, sequences, forms, flows, pipelines, members] = await Promise.all([
    listLists(user.id),
    listSequences(user.id),
    listForms(user.id),
    listFlows(user.id),
    listPipelinesWithStages(user.id),
    user.team?.id ? listMembers(user.team.id) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  return {
    lists,
    sequences: sequences.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name })),
    forms: forms.map((f) => ({ id: f.id, name: f.name })),
    flows: flows.map((f) => ({ id: f.id, name: f.name })),
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    owners: members.map((m) => ({ id: m.user_id, label: m.name || m.email })),
  };
}
