/**
 * Respuestas del modelo falso del asistente (ASSISTANT_FAKE=1, e2e). Entiende
 * un puñado de pedidos en inglés y usa las mismas herramientas que el modelo
 * real, así el flujo completo (permisos, tarjetas, confirmación) corre igual.
 */
import type { FakeCallInfo, FakeStep } from '../crm-ai-fake';

/** El pedido de cierre del motor (engine.ts WRAP_UP_MARK); acá suelto para no importar el motor. */
const WRAP_UP_MARK = '[wrap-up]';
/** "Revisá todo el catálogo": el modelo falso busca sin parar (como el que se quedaba sin pasos). */
const DIG = /^dig through (?:the|every) catalog|^revis(?:a|á) todo el cat(?:a|á)logo/i;

function apps(system: string): string[] {
  const m = /Apps they can use here: ([^.\n]*)\./.exec(system);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
}

export function fakeAssistantStep(info: FakeCallInfo): FakeStep {
  const last = (info.userTexts[info.userTexts.length - 1] ?? '').trim();
  const can = apps(info.system);
  const done = info.toolResults[info.toolResults.length - 1];
  // Cierre: sin herramientas, cuenta qué hizo y qué espera confirmación.
  if (last.startsWith(WRAP_UP_MARK)) {
    const pending = info.toolResults.filter((r) => (r.output as { status?: unknown } | null)?.status === 'awaiting_user_confirmation').length;
    return {
      text: `I used ${info.toolResults.length} steps and stopped there. ${pending ? `${pending} change(s) wait for your confirmation on the card.` : 'Nothing waits for confirmation yet.'} Tell me if I should keep going.`,
    };
  }
  const asked = [...info.userTexts].reverse().find((u) => !u.startsWith(WRAP_UP_MARK)) ?? '';
  if (DIG.test(asked)) return { tool: 'find_operations', input: { query: `folders ${info.toolResults.length}` } };
  // "Callado": el modelo termina sin texto después de una herramienta (el motor pide el cierre).
  if (done && /^(?:list|show) my inbox folders silently/i.test(asked)) return { text: '' };
  const chats = chatsFlow(asked, done, info.userTexts);
  if (chats) return chats;
  if (done) {
    const out = (done.output ?? {}) as Record<string, unknown>;
    if (done.tool === 'propose_folders_from_json') return foldersReply(out);
    if (done.tool === 'inbox_folders') {
      const rows = (out.folders as Array<{ path: string; chats: number }>) ?? [];
      if (!rows.length) return { text: 'You have no Inbox folders yet.' };
      return {
        text: [
          `## Your Inbox folders`,
          '',
          `You have **${rows.length} folders** and ${String(out.totalChats ?? 0)} chats in Inbox.`,
          '',
          '| Folder | Chats |',
          '| --- | ---: |',
          ...rows.map((r) => `| ${r.path} | ${r.chats} |`),
          '',
          'To move them somewhere else, export them as JSON:',
          '',
          '```json',
          JSON.stringify({ folders: rows.slice(0, 2).map((r) => ({ path: r.path, chats: [] })) }, null, 2),
          '```',
        ].join('\n'),
      };
    }
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
  // Carpetas desde un JSON (pegado o adjunto): el plan lo arma la herramienta leyendo la charla.
  if (/create the folders|crea(?:r|me)? las carpetas|criar? as pastas|folders from (?:this|the|my) json|configur(?:a|á|e|es) (?:mis|my|minhas) (?:carpetas|folders|pastas)/i.test(last)) {
    const removeFromOtherFolders = /move them|sac(?:a|á)los|mov(?:e|é)los/i.test(last);
    const inbox = /\binbox\b/i.test(last);
    const lines = /\blines\b/i.test(last);
    return {
      reasoning: 'The person pasted a JSON exported from another inbox and wants its folders, subfolders and chats here. I will plan it first with propose_folders_from_json, which reads the JSON from the chat, and show the plan for confirmation.',
      tool: 'propose_folders_from_json',
      input: { target: inbox && lines ? 'both' : lines ? 'lines' : 'inbox', ...(removeFromOtherFolders ? { removeFromOtherFolders: true } : {}) },
    };
  }
  if (/^(?:summari[sz]e|list|show) my inbox folders/i.test(last)) return { reasoning: 'Read the Inbox folders and count the chats in each.', tool: 'inbox_folders', input: {} };
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

/** Respuesta al plan de carpetas: una tabla con lo que se crea y lo que no encontró. */
function foldersReply(out: Record<string, unknown>): FakeStep {
  if (out.error === 'nothing_to_do') return { text: 'Everything in that JSON is already in place. Nothing to change.' };
  if (out.error) {
    const hint = typeof out.hint === 'string' ? out.hint : '';
    return { text: `I could not read the folders (${String(out.error)}). ${hint}`.trim() };
  }
  type Plan = {
    foldersToCreate?: Array<{ path: string; chats: number }>;
    foldersReused?: Array<{ path: string; chats: number }>;
    notFound?: Array<{ chat: string; folder: string; closest: string[] }>;
  };
  // Inbox y Lines en una tarjeta: el plan trae uno por destino; la tabla muestra el primero.
  const raw = (out.plan ?? {}) as Plan & { targets?: Plan[] };
  const plan = raw.targets?.[0] ?? raw;
  const rows = [...(plan.foldersToCreate ?? []).map((f) => ({ ...f, state: 'new' })), ...(plan.foldersReused ?? []).map((f) => ({ ...f, state: 'exists' }))];
  const missing = plan.notFound ?? [];
  return {
    text: [
      'Here is the plan. Nothing changes until you confirm.',
      '',
      '| Folder | Chats | |',
      '| --- | ---: | --- |',
      ...rows.map((r) => `| ${r.path} | ${r.chats} | ${r.state} |`),
      '',
      ...(missing.length
        ? [`**Not found (${missing.length}):**`, ...missing.map((m) => `- ${m.chat} in *${m.folder}*${m.closest.length ? `: maybe ${m.closest.join(', ')}?` : ''}`), '']
        : []),
      'Click **Confirm** on the card to apply it.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// "¿Qué tengo atrasado?": lista, permiso para leer, leer y proponer acciones.
// Contesta en el idioma en que escribe la persona (como pide el motor).
// ---------------------------------------------------------------------------

type Lang = 'es' | 'pt' | 'en';

function langOf(text: string): Lang {
  if (/\b(você|tenho|leia|obrigad[oa]|conversas)\b|ç|ã|õ/i.test(text)) return 'pt';
  if (/[¿¡ñ]|\b(qué|que tengo|tengo|leé|leelos|léelos|sí|dame|mis|seguí|permitido)\b/i.test(text)) return 'es';
  return 'en';
}

const BEHIND = /qu[eé] tengo atrasado|what am i behind|what do i owe|o que (?:eu )?tenho atrasado|recomendaci|recommendations|recomenda[cç]/i;
const READ_THEM = /^(?:s[ií],? )?(?:le[eé]los|leelos|léelos|read them|leia|lê)|^(?:yes,? )?read (?:them|my chats)/i;
const CONTINUE = /^(?:permitido\. segu[ií]|allowed\. go ahead|permitido\. pode seguir)/i;

const T: Record<Lang, Record<string, string>> = {
  es: {
    none: 'No tenés nada atrasado en Inbox.',
    head: 'Esto es lo que tenés atrasado en Inbox:',
    waiting: 'esperando tu respuesta hace {h}',
    ask: '¿Querés que lea esos chats para recomendarte qué hacer?',
    permission: 'Para recomendarte algo necesito leer esos chats. Elegí en la tarjeta si me dejás leerlos.',
    proposed: 'Leí {n} chats. Te propongo un borrador de respuesta y posponer el resto hasta mañana. Revisalo y confirmá en la tarjeta.',
    draft: '¡Hola! Perdón la demora, ya lo reviso y te respondo hoy.',
  },
  pt: {
    none: 'Você não tem nada atrasado no Inbox.',
    head: 'Isto é o que está atrasado no Inbox:',
    waiting: 'esperando sua resposta há {h}',
    ask: 'Quer que eu leia essas conversas para recomendar o que fazer?',
    permission: 'Para recomendar algo preciso ler essas conversas. Escolha no cartão se você permite.',
    proposed: 'Li {n} conversas. Proponho um rascunho de resposta e adiar o resto até amanhã. Revise e confirme no cartão.',
    draft: 'Oi! Desculpe a demora, vou ver e te respondo hoje.',
  },
  en: {
    none: 'Nothing is overdue in Inbox.',
    head: 'This is what you are behind on in Inbox:',
    waiting: 'waiting for your reply for {h}',
    ask: 'Do you want me to read those chats and recommend what to do?',
    permission: 'To recommend something I need to read those chats. Choose on the card if you allow it.',
    proposed: 'I read {n} chats. I suggest a reply draft and snoozing the rest until tomorrow. Review it and confirm on the card.',
    draft: 'Hi! Sorry for the delay, I will check and get back to you today.',
  },
};

function unwrap(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v.slice(v.indexOf('\n') + 1, v.lastIndexOf('\n</untrusted_data')));
  } catch {
    return null;
  }
}

function chatsFlow(asked: string, done: FakeCallInfo['toolResults'][number] | undefined, said: string[]): FakeStep | null {
  // "Permitido. Seguí." lo manda la tarjeta en el idioma de la app: el idioma es el de lo que escribió la persona antes.
  const lang = langOf([...said].reverse().find((u) => !CONTINUE.test(u) && !u.startsWith(WRAP_UP_MARK)) ?? asked);
  const t = T[lang];
  const out = (done?.output ?? {}) as Record<string, unknown>;
  if (done?.tool === 'inbox_attention') {
    const waiting = (out.waitingForReply as Array<{ name: string; waitingHours?: number }>) ?? [];
    const overdue = (out.overdueFollowUps as Array<{ name: string }>) ?? [];
    if (!waiting.length && !overdue.length) return { text: t.none };
    return {
      text: [t.head, '', ...waiting.slice(0, 8).map((c) => `- **${c.name}**: ${t.waiting.replace('{h}', span(c.waitingHours ?? 0, lang))}`), ...overdue.slice(0, 5).map((c) => `- **${c.name}**`), '', t.ask].join('\n'),
    };
  }
  if (done?.tool === 'inbox_read_chats') {
    if (out.status === 'awaiting_permission') return { text: t.permission };
    const chats = (unwrap(out.chats) as Array<{ id: string; name: string }> | null) ?? [];
    if (!chats.length) return { text: t.none };
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(12, 0, 0, 0);
    return {
      tool: 'propose_inbox_actions',
      input: {
        actions: [
          { chat: chats[0].id, do: 'draft', text: t.draft },
          ...chats.slice(1, 4).map((c) => ({ chat: c.id, do: 'snooze', until: tomorrow.toISOString() })),
        ],
      },
    };
  }
  if (done?.tool === 'propose_inbox_actions' && out.status === 'awaiting_user_confirmation') {
    const n = ((out.plan as { planned?: unknown[] } | undefined)?.planned ?? []).length;
    return { text: t.proposed.replace('{n}', String(n)) };
  }
  if (done) return null;
  if (BEHIND.test(asked)) return { reasoning: 'Look at what is waiting in Inbox first (no message text needed).', tool: 'inbox_attention', input: {} };
  if (READ_THEM.test(asked) || CONTINUE.test(asked)) return { tool: 'inbox_read_chats', input: {} };
  return null;
}

/** "5 h" o, desde dos días, "3 días". */
function span(h: number, lang: Lang): string {
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${lang === 'en' ? 'days' : lang === 'pt' ? 'dias' : 'días'}`;
}
