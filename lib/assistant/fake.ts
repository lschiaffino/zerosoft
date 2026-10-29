/**
 * Respuestas del modelo falso del asistente (ASSISTANT_FAKE=1, e2e). Entiende
 * un puñado de pedidos en inglés y usa las mismas herramientas que el modelo
 * real, así el flujo completo (permisos, tarjetas, confirmación) corre igual.
 */
import type { FakeCallInfo, FakeStep } from '../crm-ai-fake';

function apps(system: string): string[] {
  const m = /Apps they can use here: ([^.\n]*)\./.exec(system);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
}

export function fakeAssistantStep(info: FakeCallInfo): FakeStep {
  const last = (info.userTexts[info.userTexts.length - 1] ?? '').trim();
  const can = apps(info.system);
  const done = info.toolResults[info.toolResults.length - 1];
  if (done) {
    const out = (done.output ?? {}) as Record<string, unknown>;
    if (out.error) return { text: `I could not do that (${String(out.error)}).` };
    if (out.status === 'awaiting_user_confirmation') return { text: `${String(out.summary)}. Review the card and confirm.` };
    if (done.tool === 'crm_list_deals') {
      const deals = (out.deals as Array<{ name: string }>) ?? [];
      return { text: deals.length ? `Found ${deals.length} deals: ${deals.map((d) => d.name).join(', ')}.` : 'No deals match.' };
    }
    if (done.tool === 'search_workspace') {
      const rows = (out.results as Array<{ name: string }>) ?? [];
      return { text: rows.length ? `Found: ${rows.map((r) => r.name).join(', ')}.` : 'Nothing matches.' };
    }
    if (done.tool === 'list_webhooks') {
      const rows = (out.webhooks as unknown[]) ?? [];
      return { text: rows.length ? `You have ${rows.length} webhooks. Check the last delivery of each.` : 'There are no webhooks in this workspace, so nothing could fire.' };
    }
    if (done.tool === 'list_members') {
      const rows = (out.members as Array<{ email: string }>) ?? [];
      return { text: `Members: ${rows.map((r) => r.email).join(', ')}.` };
    }
    return { text: 'Done looking that up.' };
  }
  const pipeline = /^create (?:a )?pipeline "?([^"]+?)"? with stages (.+)$/i.exec(last);
  if (pipeline) {
    if (!can.includes('crm')) return { text: 'I cannot use CRM in this workspace.' };
    return { tool: 'propose_crm_create_pipeline', input: { name: pipeline[1].trim(), stages: pipeline[2].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean) } };
  }
  if (/deals closing this month/i.test(last)) {
    if (!can.includes('crm')) return { text: 'I cannot use CRM in this workspace.' };
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { tool: 'crm_list_deals', input: { closeFrom: from, closeTo: to } };
  }
  const invite = /^invite (\S+@\S+)(?: as (member|admin|guest))?/i.exec(last);
  if (invite) return { tool: 'propose_invite_member', input: { email: invite[1], role: (invite[2] ?? 'member').toLowerCase() } };
  if (/webhook/i.test(last)) return { tool: 'list_webhooks', input: {} };
  if (/members|who is in/i.test(last)) return { tool: 'list_members', input: {} };
  const find = /^(?:find|search) (.+)$/i.exec(last);
  if (find) return { tool: 'search_workspace', input: { query: find[1] } };
  return { text: `I can look things up and prepare changes for you to confirm. Apps here: ${can.join(', ') || 'none'}.` };
}
