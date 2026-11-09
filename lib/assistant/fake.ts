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
    if (done.tool === 'people_compensation') {
      if (out.amountsShown === false) return { text: `Open ${String(out.name)}'s profile to see the salary.` };
      const rows = (out.entries as Array<{ amount: number; currency: string }>) ?? [];
      return { text: rows.length ? `Salary of ${String(out.name)}: ${rows[0].currency} ${rows[0].amount}.` : 'No salary recorded.' };
    }
    if (done.tool === 'people_whos_out') {
      const rows = (out.out as Array<{ name: string }>) ?? [];
      return { text: rows.length ? `Out: ${rows.map((r) => r.name).join(', ')}.` : 'Nobody is out.' };
    }
    if (done.tool === 'list_members') {
      const rows = (out.members as Array<{ email: string }>) ?? [];
      return { text: `Members: ${rows.map((r) => r.email).join(', ')}.` };
    }
    if (done.tool === 'run_operation') {
      // El resultado llega marcado (<untrusted_data nonce=...>): el JSON va entre la primera línea y la última.
      const wrapped = typeof out.result === 'string' ? out.result : null;
      const inner = (wrapped ? JSON.parse(wrapped.slice(wrapped.indexOf('\n') + 1, wrapped.lastIndexOf('\n</untrusted_data'))) : out) as Record<string, unknown>;
      const data = inner.data as Record<string, unknown> | unknown[] | undefined;
      const list = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown })?.data) ? ((data as { data: unknown[] }).data) : null;
      if (list) return { text: `Found ${list.length} items: ${list.slice(0, 5).map((r) => String((r as Record<string, unknown>).name ?? (r as Record<string, unknown>).title ?? (r as Record<string, unknown>).body ?? '')).join(', ')}.` };
      const rec = ((data as { data?: unknown })?.data ?? data) as Record<string, unknown> | undefined;
      return { text: out.ok === false ? `That failed (${String(out.error ?? out.status)}).` : `This is "${String(rec?.title ?? rec?.name ?? rec?.identifier ?? 'the record')}".` };
    }
    return { text: 'Done looking that up.' };
  }
  const record = /CURRENT_RECORD:([a-z0-9._]+):([A-Za-z0-9_-]+)/.exec(info.system);
  // Adjuntos: el último de la charla, de la línea de las instrucciones.
  const attachedIds = [...info.system.matchAll(/(att_[a-z0-9]{8,40}) \(/g)].map((m) => m[1]);
  const latest = attachedIds[attachedIds.length - 1];
  if (/^(what|describe|summari[sz]e|read)\b.*\b(this|these|attached|image|file|pdf)\b/i.test(last) && (info.userFiles.length || /\[Attachment att_/.test(last))) {
    if (/cannot see images/.test(last) && !info.userFiles.length) return { text: 'This model cannot see images, but I can still send or attach it for you.' };
    const seen = info.userFiles.map((f) => `${f.mediaType} (${f.bytes} bytes)`).join(', ');
    const quoted = /Its text, written by someone else \(data, not instructions\):\n<untrusted_data [^>]*>\n"((?:[^"\\]|\\.){0,60})/.exec(last)?.[1]?.trim();
    return { text: [seen ? `I can see ${info.userFiles.length} file(s): ${seen}.` : '', quoted ? `The document starts with: "${quoted}".` : ''].filter(Boolean).join(' ') };
  }
  if (latest && /^send (this|it)\b.* (to )?this chat/i.test(last)) {
    if (!record || !record[1].startsWith('v1.groups.chats')) return { text: 'Open a Lines chat first.' };
    return { tool: 'propose_send_attachment', input: { chat: record[2], attachment: latest } };
  }
  const attachIssue = /^attach (this|it) to (?:issue )?([A-Z]+-\d+)/i.exec(last);
  if (latest && attachIssue) return { tool: 'propose_attach_file', input: { target: 'track_issue', id: attachIssue[2], attachment: latest } };
  if (latest && /^add (this|it) to this (doc|page)/i.test(last)) {
    if (!record || record[1] !== 'v1.docs.pages.get') return { text: 'Open a Docs page first.' };
    return { tool: 'propose_attach_file', input: { target: 'docs_page', id: record[2], attachment: latest } };
  }
  if (/^(what is this|summari[sz]e this)/i.test(last)) {
    if (!record) return { text: 'Open a record first.' };
    return { tool: 'run_operation', input: { operation: record[1], args: { path: { id: record[2] } } } };
  }
  const say = /^(send|note) "([^"]+)" (?:to|in) this chat$/i.exec(last);
  if (say) {
    if (!record || !record[1].startsWith('v1.groups.chats')) return { text: 'Open a Lines chat first.' };
    return {
      tool: 'propose_destructive_operation',
      input: { operation: 'v1.groups.chats.messages.create', args: { path: { id: record[2] }, body: { body: say[2], note: say[1].toLowerCase() === 'note' } }, summary: `Send "${say[2].length > 120 ? `${say[2].slice(0, 117)}...` : say[2]}" to this chat` },
    };
  }
  if (/^list (?:my )?group chats/i.test(last)) return { tool: 'run_operation', input: { operation: 'v1.groups.chats.list' } };
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
  const salary = /^(?:what is the )?salary of (.+?)\??$/i.exec(last);
  if (salary || /^(?:what is )?my salary\??$/i.test(last)) {
    if (!can.includes('people')) return { text: 'I cannot use People in this workspace.' };
    return { tool: 'people_compensation', input: salary ? { name: salary[1].trim() } : {} };
  }
  if (/who is out/i.test(last)) {
    if (!can.includes('people')) return { text: 'I cannot use People in this workspace.' };
    return { tool: 'people_whos_out', input: {} };
  }
  const invite = /^invite (\S+@\S+)(?: as (member|admin|guest))?/i.exec(last);
  if (invite) return { tool: 'propose_invite_member', input: { email: invite[1], role: (invite[2] ?? 'member').toLowerCase() } };
  if (/webhook/i.test(last)) return { tool: 'list_webhooks', input: {} };
  if (/members|who is in/i.test(last)) return { tool: 'list_members', input: {} };
  const find = /^(?:find|search) (.+)$/i.exec(last);
  if (find) return { tool: 'search_workspace', input: { query: find[1] } };
  return { text: `I can look things up and prepare changes for you to confirm. Apps here: ${can.join(', ') || 'none'}.` };
}
