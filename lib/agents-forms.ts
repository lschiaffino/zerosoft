/**
 * Agents — lo que pasa cuando el visitante envía un formulario del chat.
 *
 * - Solo se acepta el formulario que el agente mostró: el de la última
 *   respuesta de la conversación o el del paso de procedimiento que lo espera
 *   (formShownInConversation). Un formId inventado no crea nada.
 * - Queda registrado en la conversación (agent_tool_calls, 'form_submit').
 * - Si el formulario guarda en el CRM: un contacto nuevo se crea con los
 *   datos; uno que ya existía solo se toca si el email es el del visitante
 *   identificado (firma del widget o la API). Si no, queda una nota suelta
 *   con lo enviado (nadie pisa ni anota el contacto de otra persona
 *   escribiendo su email).
 * - Los valores que van a campos del CRM no pueden empezar con = + - @
 *   (fórmulas al exportar a una planilla).
 * En el playground se simula. Server-only.
 */
import { getDb } from './db';
import type { AgentConversationRow, AgentRow } from './db';
import type { AgentForm } from './agents-config';
import { crmContactFromForm, parseUi } from './agents-ui-blocks';
import { parseProcedureState } from './agents-procedures';

/** Saca los caracteres que una planilla interpreta como fórmula al principio del valor. */
export function crmSafe(value: string): string {
  return value.replace(/^[\s=+\-@]+/, '').slice(0, 300);
}

/**
 * ¿El agente mostró este formulario en la conversación? El de la última
 * respuesta, o el del paso de procedimiento que está esperando.
 */
export async function formShownInConversation(
  conversation: Pick<AgentConversationRow, 'id' | 'procedure_state'>,
  formId: string,
  procedures: Array<{ id: string; steps: Array<{ id: string; kind: string; formId: string | null }> }>,
): Promise<boolean> {
  const last = (await getDb()
    .prepare("SELECT ui FROM agent_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(conversation.id)) as { ui: string | null } | undefined;
  const ui = parseUi(last?.ui ?? null);
  if (ui?.kind === 'form' && ui.formId === formId) return true;
  const state = parseProcedureState(conversation.procedure_state ?? null);
  if (state?.awaiting) {
    const step = procedures.find((p) => p.id === state.procedureId)?.steps.find((s) => s.id === state.stepId);
    if (step?.kind === 'form' && step.formId === formId) return true;
  }
  return false;
}

export async function saveFormSubmission(input: {
  agent: AgentRow;
  conversation: AgentConversationRow;
  form: AgentForm;
  values: Record<string, string>;
  dryRun: boolean;
}): Promise<Record<string, unknown>> {
  const { agent, conversation, form, values } = input;
  const started = Date.now();
  let output: Record<string, unknown> = { saved: false };
  let error: string | null = null;
  if (form.saveToCrm) {
    // Cada valor (salvo email y teléfono, ya validados) sin = + - @ al principio.
    const safe: Record<string, string> = {};
    for (const f of form.fields) {
      const v = values[f.key];
      if (v !== undefined) safe[f.key] = f.type === 'email' || f.type === 'phone' ? v : crmSafe(v);
    }
    const lead = crmContactFromForm(form, safe);
    const firstName = lead.firstName;
    const lastName = lead.lastName;
    const note = lead.note;
    if (!lead.email) {
      error = 'no_email';
      output = { error };
    } else if (input.dryRun) {
      output = { simulated: true, wouldRun: { action: 'save_lead', email: lead.email, name: `${firstName} ${lastName}`.trim() || null } };
    } else {
      const { createActivity, updateContact } = await import('./crm');
      const existing = (await getDb()
        .prepare('SELECT id, first_name, last_name FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) LIMIT 1')
        .get(agent.user_id, lead.email)) as { id: string; first_name: string; last_name: string } | undefined;
      const verified = (conversation.visitor_email ?? '').trim().toLowerCase() === lead.email;
      if (existing && !verified) {
        // Contacto que ya existía y un email que cualquiera pudo escribir: solo una nota suelta.
        await createActivity(agent.user_id, {
          type: 'note',
          subject: `${agent.name}: ${form.name} (${lead.email}, unverified)`,
          body: note,
        });
        output = { saved: true, existing: true, verified: false };
      } else {
        const { findOrCreateContact } = await import('./crm-integrations');
        const name = `${firstName} ${lastName}`.trim() || null;
        const { contact, created } = await findOrCreateContact(agent.user_id, { email: lead.email, name, source: 'other', phone: lead.phone || null });
        if (!created && !contact.first_name && !contact.last_name && firstName) {
          await updateContact(agent.user_id, contact.id, { firstName, lastName }).catch(() => null);
        }
        await createActivity(agent.user_id, { type: 'note', subject: `${agent.name}: ${form.name}`, body: note, contactId: contact.id });
        output = { saved: true, contactId: contact.id, created };
      }
    }
  }
  await getDb()
    .prepare(
      `INSERT INTO agent_tool_calls (id, agent_id, user_id, conversation_id, run_id, tool, input, output, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, 'form_submit', ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      agent.id,
      agent.user_id,
      conversation.id,
      `form:${crypto.randomUUID()}`,
      JSON.stringify({ form: form.id, values }).slice(0, 4000),
      JSON.stringify(output).slice(0, 4000),
      error,
      Date.now() - started,
      new Date().toISOString(),
    );
  return output;
}
