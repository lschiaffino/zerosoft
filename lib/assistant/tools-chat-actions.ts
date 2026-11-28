/**
 * El asistente actúa sobre Lines e Inbox, siempre con tarjeta de aprobación.
 *
 * - lines_find_chats / inbox_find_chats: buscar un chat por nombre o teléfono. Solo datos de la lista (nombre,
 *   línea, asignación, no leídos, última actividad), nunca el texto de un mensaje: no piden permiso. Lines con el
 *   acceso por línea, etiqueta y asignación de quien pide (y los teléfonos ocultos si no los ve); Inbox, solo los
 *   chats de la persona.
 * - propose_lines_actions: en una sola tarjeta, borrador de respuesta (va al campo del chat, no se manda), asignar,
 *   etiquetar, cerrar, archivar, nota interna, tarea, ticket y mensaje programado. Cada fila dice qué, dónde y el texto. Un programado sale a WhatsApp a
 *   la hora elegida: la tarjeta lo dice y se confirma con el botón rojo; si la hora ya pasó al confirmar, no se
 *   programa (nunca sale en el acto).
 * - propose_inbox_actions (lib/assistant/tools-chats.ts) suma la nota del chat y el mensaje programado.
 *
 * Nada cambia hasta que la persona hace clic en Confirmar: `execute` corre con la sesión de ese clic y vuelve a mirar
 * el acceso a cada chat (si se lo sacaron en el medio, esa fila no se hace).
 */
import { z } from 'zod';
import { createTranslator } from 'next-intl';
import { getDb } from '../db';
import { delegatedIdentity } from '../mcp/identity';
import { GroupsError, getChatRow, getNumberRow, listLabels, listPeople, sendMessage, type ChatRow } from '../groups';
import { canSeeChat, chatAccessSql, groupsViewer, maskPhone, maskedChatName, type GroupsViewer } from '../groups-access';
import { wrapUntrusted } from '../mcp/untrusted';
import enMessages from '../../messages/en/assistant.json';
import esMessages from '../../messages/es/assistant.json';
import ptMessages from '../../messages/pt/assistant.json';
import { cardTime, readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const MESSAGES = { en: enMessages, es: esMessages, pt: ptMessages } as const;

function translator(locale: string) {
  const loc = (locale in MESSAGES ? locale : 'en') as keyof typeof MESSAGES;
  return createTranslator({ locale: loc, messages: MESSAGES[loc] as never, namespace: 'chats.lines' as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
}

const MAX_ACTIONS = 20;
/** Un programado tiene que quedar al menos este tiempo en el futuro al confirmar (nunca sale en el acto). */
const SCHEDULE_MIN_LEAD_MS = 60_000;

function hoursSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 3_600_000)) : null;
}


// ---------------------------------------------------------------------------
// Buscar chats
// ---------------------------------------------------------------------------

const findInput = z.object({
  query: z.string().trim().min(1).max(120).describe('Part of the chat name, the contact name or the phone number.'),
  limit: z.number().int().min(1).max(20).optional(),
});

/** Un chat de Lines como lo ve quien pide (nombre con los teléfonos ocultos si no los ve), con su línea. */
interface FoundChat {
  id: string;
  key: string;
  name: string;
  line: string;
  group: boolean;
  phone: string;
  unread: number;
  lastMessageAt: string | null;
  assignedTo: string | null;
}

/**
 * Chats de Lines que quien pide ve, por nombre o (si ve los teléfonos) por teléfono. Nunca por el texto de los
 * mensajes: buscar no lee mensajes. `exact`: el nombre entero (sin distinguir mayúsculas).
 */
async function searchLinesChats(ctx: ToolCtx, viewer: GroupsViewer, query: string, opts: { exact?: boolean; limit: number }): Promise<FoundChat[]> {
  const q = query.trim();
  if (!q) return [];
  const access = chatAccessSql(viewer, 'c');
  const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  const digits = q.replace(/\D/g, '');
  const byName = opts.exact ? 'c.name = ? COLLATE NOCASE' : "c.name LIKE ? ESCAPE '\\'";
  // Por teléfono solo si quien pide los ve (si no, buscar por número diría de quién es).
  const byPhone = !opts.exact && !viewer.mask && digits.length >= 4 ? " OR c.phone LIKE ? ESCAPE '\\'" : '';
  const args: Array<string | number> = [ctx.workspaceId, opts.exact ? q : like, ...(byPhone ? [`%${digits}%`] : []), ...(access?.args ?? []), opts.limit];
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.kind, c.name, c.phone, c.provider_chat_id, c.unread_count, c.last_message_at, c.assigned_to, n.name AS line_name, n.phone AS line_phone
       FROM groups_chats c JOIN groups_numbers n ON n.id = c.number_id AND n.user_id = c.user_id
       WHERE c.user_id = ? AND c.hidden_at IS NULL AND (${byName}${byPhone})${access ? ` AND ${access.sql}` : ''}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?`,
    )
    .all(...args)) as Array<{ id: string; kind: string; name: string; phone: string; provider_chat_id: string; unread_count: number; last_message_at: string | null; assigned_to: string | null; line_name: string; line_phone: string }>;
  const { chatKey } = await import('../groups-same-chat');
  return rows.map((r) => ({
    id: r.id,
    key: chatKey(r) || r.id,
    name: maskedChatName(viewer, r),
    line: r.line_name || (r.line_phone ? (viewer.mask ? maskPhone(r.line_phone) : `+${r.line_phone}`) : ''),
    group: r.kind === 'group',
    phone: r.kind === 'group' || !r.phone ? '' : viewer.mask ? maskPhone(r.phone) : `+${r.phone}`,
    unread: Number(r.unread_count) || 0,
    lastMessageAt: r.last_message_at,
    assignedTo: r.assigned_to,
  }));
}

async function linesFind(ctx: ToolCtx, query: string, limit: number) {
  const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
  const rows = await searchLinesChats(ctx, viewer, query, { limit });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    line: c.line,
    group: c.group,
    ...(c.phone ? { phone: c.phone } : {}),
    unread: c.unread,
    lastMessageAt: c.lastMessageAt,
    assigned: c.assignedTo ? (c.assignedTo === ctx.personId ? 'me' : 'someone else') : 'nobody',
    href: `/app/lines/inbox/${c.id}`,
  }));
}

async function inboxFind(owner: string, query: string, limit: number) {
  const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, handle, channel, kind, unread, last_message_at FROM inbox_threads
       WHERE owner_id = ? AND removed_at IS NULL AND (title LIKE ? ESCAPE '\\' OR handle LIKE ? ESCAPE '\\')
       ORDER BY last_message_at DESC LIMIT ?`,
    )
    .all(owner, like, like, limit)) as Array<{ id: string; title: string; handle: string; channel: string; kind: string; unread: number; last_message_at: string | null }>;
  return rows.map((r) => ({ id: r.id, name: r.title || r.handle, channel: r.channel, group: r.kind === 'group', unread: Number(r.unread) || 0, lastMessageAt: r.last_message_at, href: `/app/inbox?t=${r.id}` }));
}

// ---------------------------------------------------------------------------
// Lines: acciones con tarjeta
// ---------------------------------------------------------------------------

export const LINES_ACTIONS = ['draft', 'assign', 'label', 'close', 'archive', 'note', 'task', 'ticket', 'schedule'] as const;
type LinesDo = (typeof LINES_ACTIONS)[number];

const linesInput = z.object({
  actions: z
    .array(
      z.object({
        chat: z.string().trim().min(1).max(120).describe('Chat id from lines_find_chats or lines_attention (or its exact name).'),
        do: z
          .enum(LINES_ACTIONS)
          .describe(
            'draft: put a reply in the message field of the chat for the person to review (nothing is sent). assign: assign the chat to a person or team. label: add an existing label of the workspace (keeps the ones it has). close: close the conversation (it reopens with the next message). archive: archive the chat. note: internal note only the team sees. task: a task linked to the chat. ticket: open a support ticket on the chat. schedule: a WhatsApp message sent at a future time.',
          ),
        text: z.string().max(4000).optional().describe('draft / note / schedule: the text, in the language of the chat. task / ticket: the title.'),
        label: z.string().trim().min(1).max(40).optional().describe('label: the name of an existing label.'),
        to: z.string().trim().min(1).max(200).optional().describe('assign: "me", a teammate name or email, or a team name. task: who owns the task (default: me).'),
        at: z.string().max(40).optional().describe('schedule: ISO date-time in the future when the message goes out. task: due date (optional).'),
      }),
    )
    .min(1)
    .max(MAX_ACTIONS),
});

export interface LinesPlanned {
  chatId: string;
  name: string;
  /** Dónde está el chat (línea, teléfono oculto si hace falta, o "grupo"), para la tarjeta. */
  where?: string;
  do: LinesDo;
  text?: string;
  /** label: la etiqueta. */
  labelId?: string;
  /** assign: persona o equipo. task: dueña. ticket: a quién va (si no, quien tiene el chat). */
  personId?: string;
  teamId?: string;
  who?: string;
  at?: string;
  line?: string;
}

/**
 * Un chat por id o por su nombre entero, solo entre los que quien pide ve. Si el nombre es de varios chats distintos
 * no elige: vuelve con los candidatos (id, nombre y línea) para que el modelo pregunte o use el id. El mismo chat en
 * varias líneas cuenta como uno (el de actividad más reciente).
 */
async function resolveLinesChat(ctx: ToolCtx, viewer: GroupsViewer, ref: string): Promise<{ chat: ChatRow } | { problem: string }> {
  if (await canSeeChat(viewer, ref)) {
    const chat = await getChatRow(ctx.workspaceId, ref);
    if (chat) return { chat };
  }
  const exact = await searchLinesChats(ctx, viewer, ref, { exact: true, limit: 20 });
  const keys = new Set(exact.map((c) => c.key));
  if (keys.size === 1) {
    const chat = await getChatRow(ctx.workspaceId, exact[0].id);
    if (chat) return { chat };
  }
  if (keys.size > 1) {
    const list = exact.slice(0, 6).map((c) => `${c.id} (${[c.name, c.line, c.group ? 'group' : c.phone].filter(Boolean).join(' · ')})`);
    return { problem: `${ref}: ambiguous, several chats have that name. Use one of these ids or ask the person: ${list.join('; ')}` };
  }
  const near = await searchLinesChats(ctx, viewer, ref, { limit: 5 });
  return { problem: `${ref}: chat_not_found${near.length ? `. Similar names: ${near.map((c) => `${c.id} (${c.name} · ${c.line})`).join('; ')}` : ''}` };
}

/** Dónde está el chat, para la tarjeta: la línea y el teléfono (oculto si quien pide no los ve) o "grupo". */
function chatWhere(viewer: GroupsViewer, chat: ChatRow, lineName: string, t: (k: string) => string): string {
  const who = chat.kind === 'group' ? t('group') : chat.phone ? (viewer.mask ? maskPhone(chat.phone) : `+${chat.phone}`) : '';
  return [lineName, who].filter(Boolean).join(' · ');
}

/** "me", un nombre o un email del workspace (uno solo), o el nombre de un equipo de Lines. */
async function resolveAssignee(ctx: ToolCtx, ref: string): Promise<{ personId?: string; teamId?: string; who: string } | null> {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  const people = await listPeople(ctx.workspaceId);
  if (r === 'me' || r === 'yo' || r === 'eu' || r === 'mí' || r === 'mi') {
    const me = people.find((p) => p.id === ctx.personId);
    return { personId: ctx.personId, who: me?.name || me?.email || 'me' };
  }
  const byEmail = people.filter((p) => p.email.toLowerCase() === r);
  const byName = byEmail.length ? byEmail : people.filter((p) => p.name.toLowerCase() === r);
  const loose = byName.length ? byName : people.filter((p) => p.name.toLowerCase().includes(r));
  if (loose.length === 1) return { personId: loose[0].id, who: loose[0].name || loose[0].email };
  if (loose.length > 1) return null;
  const { listTeams } = await import('../groups-inbox');
  const teams = (await listTeams(ctx.workspaceId)).filter((t) => t.name.toLowerCase() === r);
  return teams.length === 1 ? { teamId: teams[0].id, who: teams[0].name } : null;
}

/** Las etiquetas que tiene el chat ahora (ids y nombres). */
async function chatLabelNames(chatId: string): Promise<{ ids: string[]; names: string[] }> {
  const rows = (await getDb()
    .prepare('SELECT l.id, l.name FROM groups_chat_labels cl JOIN groups_labels l ON l.id = cl.label_id WHERE cl.chat_id = ? ORDER BY l.name COLLATE NOCASE')
    .all(chatId)) as Array<{ id: string; name: string }>;
  return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
}

function futureAt(raw: string | undefined, now: number, minLead: number): string | null {
  const t = Date.parse(raw ?? '');
  if (!Number.isFinite(t) || t < now + minLead || t > now + 366 * 86_400_000) return null;
  return new Date(t).toISOString();
}

async function prepareLines(ctx: ToolCtx, input: z.infer<typeof linesInput>) {
  const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
  const t = translator(ctx.locale);
  const now = Date.now();
  const planned: LinesPlanned[] = [];
  const problems: string[] = [];
  const before = new Map<string, string>();
  const people = await listPeople(ctx.workspaceId);
  for (const a of input.actions) {
    const found = await resolveLinesChat(ctx, viewer, a.chat);
    if ('problem' in found) {
      problems.push(found.problem);
      continue;
    }
    const chat = found.chat;
    const number = await getNumberRow(ctx.workspaceId, chat.number_id);
    const lineName = number ? number.name || (number.phone ? (viewer.mask ? maskPhone(number.phone) : `+${number.phone}`) : '') : '';
    const name = maskedChatName(viewer, chat);
    const where = chatWhere(viewer, chat, lineName, t);
    const p: LinesPlanned = { chatId: chat.id, name, where, do: a.do, line: lineName };
    const text = a.text?.trim();
    if (a.do === 'draft' || a.do === 'note' || a.do === 'schedule' || a.do === 'task') {
      if (!text) {
        problems.push(`${name}: ${a.do} needs text`);
        continue;
      }
      p.text = text.slice(0, a.do === 'task' ? 200 : 4000);
    }
    // El ticket sin título toma uno del chat (como en la app).
    if (a.do === 'ticket' && text) p.text = text.slice(0, 200);
    // Lo mismo dos veces en la misma tarjeta no suma nada.
    if ((a.do === 'close' || a.do === 'archive') && planned.some((x) => x.do === a.do && x.chatId === chat.id)) continue;
    if (a.do === 'label') {
      const ref = (a.label ?? text ?? '').trim().toLowerCase();
      const label = ref ? (await listLabels(ctx.workspaceId)).find((l) => l.name.toLowerCase() === ref) : undefined;
      if (!label) {
        problems.push(`${name}: label needs the name of an existing label (${a.label ?? ''})`);
        continue;
      }
      const cur = await chatLabelNames(chat.id);
      if (cur.ids.includes(label.id) || planned.some((x) => x.do === 'label' && x.chatId === chat.id && x.labelId === label.id)) continue;
      p.labelId = label.id;
      p.who = label.name;
      before.set(`label:${chat.id}`, cur.names.join(', ') || t('none'));
    }
    if (a.do === 'close' && chat.status === 'closed') {
      problems.push(`${name}: already closed`);
      continue;
    }
    if (a.do === 'archive' && chat.archived_at) {
      problems.push(`${name}: already archived`);
      continue;
    }
    if (a.do === 'ticket' && a.to) {
      const who = await resolveAssignee(ctx, a.to);
      if (!who?.personId) {
        problems.push(`${name}: ticket assignee not found (${a.to})`);
        continue;
      }
      p.personId = who.personId;
      p.who = who.who;
    }
    // Un solo borrador por chat en una tarjeta (el campo tiene uno).
    if (a.do === 'draft' && planned.some((x) => x.do === 'draft' && x.chatId === chat.id)) {
      problems.push(`${name}: only one draft per chat`);
      continue;
    }
    if (a.do === 'assign') {
      const who = a.to ? await resolveAssignee(ctx, a.to) : null;
      if (!who) {
        problems.push(`${name}: assign needs one teammate or team that exists (${a.to ?? ''})`);
        continue;
      }
      Object.assign(p, who);
      const cur = (await getDb().prepare('SELECT assigned_to, assigned_team_id FROM groups_chats WHERE id = ? AND user_id = ?').get(chat.id, ctx.workspaceId)) as
        | { assigned_to: string | null; assigned_team_id: string | null }
        | undefined;
      let curName = cur?.assigned_to ? (people.find((x) => x.id === cur.assigned_to)?.name ?? '') : '';
      if (!curName && cur?.assigned_team_id) {
        const { listTeams } = await import('../groups-inbox');
        curName = (await listTeams(ctx.workspaceId)).find((x) => x.id === cur.assigned_team_id)?.name ?? '';
      }
      before.set(chat.id, curName || t('nobody'));
    }
    if (a.do === 'task') {
      if (a.to) {
        const who = await resolveAssignee(ctx, a.to);
        if (!who?.personId) {
          problems.push(`${name}: task owner not found (${a.to})`);
          continue;
        }
        p.personId = who.personId;
        p.who = who.who;
      }
      if (a.at) {
        const due = futureAt(a.at, now, 0);
        if (!due) {
          problems.push(`${name}: task due date must be a valid date in the future`);
          continue;
        }
        p.at = due;
      }
    }
    if (a.do === 'schedule') {
      const at = futureAt(a.at, now, SCHEDULE_MIN_LEAD_MS);
      if (!at) {
        problems.push(`${name}: schedule needs a valid date-time in at, at least a minute from now and within a year`);
        continue;
      }
      if (!number || number.status !== 'connected' || chat.left_at) {
        problems.push(`${name}: the line of this chat is not connected`);
        continue;
      }
      p.at = at;
    }
    planned.push(p);
  }
  if (!planned.length) return { error: 'nothing_to_do', hint: problems };
  const chatLabel = (p: LinesPlanned) => (p.where ? `${p.name} (${p.where})` : p.name);
  const details = planned.map((p) => {
    switch (p.do) {
      case 'draft':
        return { label: t('do.draft', { chat: chatLabel(p) }), after: p.text!, full: true };
      case 'note':
        return { label: t('do.note', { chat: chatLabel(p) }), after: p.text!, full: true };
      case 'assign':
        return { label: t('do.assign', { chat: chatLabel(p) }), before: before.get(p.chatId) ?? null, after: p.who! };
      case 'label':
        return { label: t('do.label', { chat: chatLabel(p) }), before: before.get(`label:${p.chatId}`) ?? null, after: p.who! };
      case 'close':
        return { label: t('do.close', { chat: chatLabel(p) }), before: t('statusOpen'), after: t('statusClosed') };
      case 'archive':
        return { label: t('do.archive', { chat: chatLabel(p) }), after: t('archived') };
      case 'ticket':
        return { label: t('do.ticket', { chat: chatLabel(p) }), after: [p.text || t('ticketTitleAuto'), p.who ? t('owner', { who: p.who }) : ''].filter(Boolean).join('\n'), full: true };
      case 'task':
        return { label: t('do.task', { chat: chatLabel(p) }), after: [p.text!, p.at ? t('due', { when: cardTime(p.at, ctx) }) : '', p.who ? t('owner', { who: p.who }) : ''].filter(Boolean).join('\n'), full: true };
      case 'schedule':
        return { label: t('do.schedule', { chat: chatLabel(p), when: cardTime(p.at!, ctx), line: p.line ?? '' }), after: p.text!, full: true };
    }
  });
  const sends = planned.some((p) => p.do === 'schedule');
  return {
    summary: t('summary', { count: planned.length }),
    details: sends ? [...details, { label: t('sendsLabel'), after: t('sendsWarning') }] : details,
    input: { planned } as unknown as Record<string, unknown>,
    working: t('working'),
    // Un programado sale a WhatsApp: botón rojo, sin tipear nada.
    ...(sends ? { destructive: true, confirmText: null } : {}),
    forModel: { planned: planned.map((p) => ({ chatId: p.chatId, chat: p.name, do: p.do, ...(p.at ? { at: p.at } : {}), ...(p.who ? { to: p.who } : {}) })), ...(problems.length ? { skipped: problems } : {}) },
  };
}

/** Lo que se muestra cuando una fila falla: un código conocido, nunca el texto de un error de la base o de la red. */
function failureCode(err: unknown): string {
  if (err instanceof GroupsError) return err.code;
  const msg = err instanceof Error ? err.message : '';
  return msg === 'not_found' || msg === 'time_passed' ? msg : 'error';
}

async function executeLines(ctx: ToolCtx, raw: Record<string, unknown>) {
  const planned = (((raw as { planned?: LinesPlanned[] }).planned ?? []) as LinesPlanned[]).slice(0, MAX_ACTIONS);
  const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
  const t = translator(ctx.locale);
  const drafts: Array<{ app: 'lines'; chatId: string; text: string }> = [];
  const failed: string[] = [];
  let done = 0;
  for (const p of planned) {
    try {
      // Con la sesión del clic: si ya no ve el chat, no se hace.
      if (!(await canSeeChat(viewer, p.chatId))) throw new Error('not_found');
      if (p.do === 'draft') drafts.push({ app: 'lines', chatId: p.chatId, text: String(p.text ?? '') });
      else if (p.do === 'note') await sendMessage(ctx.workspaceId, ctx.personId, p.chatId, { body: String(p.text ?? ''), note: true });
      else if (p.do === 'assign') {
        const { patchChatAs } = await import('../groups-chat-ops');
        await patchChatAs(ctx.workspaceId, { id: ctx.personId }, p.chatId, p.teamId ? { assignedTeamId: p.teamId } : { assignedTo: p.personId ?? null });
      } else if (p.do === 'label') {
        // Suma la etiqueta a las que tiene al confirmar (no las pisa).
        const { patchChatAs } = await import('../groups-chat-ops');
        const cur = await chatLabelNames(p.chatId);
        await patchChatAs(ctx.workspaceId, { id: ctx.personId }, p.chatId, { labelIds: [...cur.ids, String(p.labelId ?? '')] });
      } else if (p.do === 'close' || p.do === 'archive') {
        // Como en la app: cerrar o archivar vale también para el mismo chat en otras líneas que la persona ve.
        const { patchChatAs } = await import('../groups-chat-ops');
        const { withSameChatIds } = await import('../groups-same-chat');
        const patch = p.do === 'close' ? ({ status: 'closed' } as const) : { archived: true };
        await patchChatAs(ctx.workspaceId, { id: ctx.personId }, p.chatId, patch);
        for (const other of (await withSameChatIds(ctx.workspaceId, viewer, [p.chatId])).filter((x) => x !== p.chatId)) {
          await patchChatAs(ctx.workspaceId, { id: ctx.personId }, other, patch).catch(() => null);
        }
      } else if (p.do === 'ticket') {
        const { createTicket } = await import('../groups-tickets');
        const { recordAudit } = await import('../groups-audit');
        const res = await createTicket(ctx.workspaceId, ctx.personId, { chatId: p.chatId, title: p.text ?? '', assigneeId: p.personId ?? null, source: 'manual' });
        if (res.created) await recordAudit(ctx.workspaceId, { chatId: res.ticket.chatId, chatName: res.ticket.chatName, actorId: ctx.personId, action: 'ticket_created', detail: { number: res.ticket.number } });
      } else if (p.do === 'task') {
        const { createGroupTask } = await import('../groups-tasks');
        await createGroupTask(ctx.workspaceId, ctx.personId, { chatId: p.chatId, title: String(p.text ?? ''), dueAt: p.at ?? null, ownerId: p.personId ?? null, locale: ctx.locale }, new Date(), viewer);
      } else if (p.do === 'schedule') {
        // La hora se vuelve a mirar al confirmar: si ya pasó (o falta menos de medio minuto) no se programa, así nunca sale en el acto.
        if (!futureAt(p.at, Date.now(), SCHEDULE_MIN_LEAD_MS / 2)) throw new Error('time_passed');
        const chat = await getChatRow(ctx.workspaceId, p.chatId);
        if (!chat) throw new Error('not_found');
        const { createBroadcast } = await import('../groups-broadcasts');
        await createBroadcast(ctx.workspaceId, ctx.personId, { numberId: chat.number_id, name: '', body: String(p.text ?? ''), media: null, chatIds: [p.chatId], poll: null, replyToId: null, mentions: null, scheduledAt: p.at!, kind: 'scheduled' });
      }
      done++;
    } catch (err) {
      failed.push(`${p.name} (${failureCode(err)})`);
    }
  }
  const one = new Set(planned.map((p) => p.chatId)).size === 1 ? planned[0]?.chatId : null;
  return {
    ok: done > 0,
    partial: failed.length > 0,
    message: [t('result', { done, total: planned.length }), drafts.length ? t('draftsReady', { count: drafts.length }) : '', failed.length ? t('resultFailed', { list: failed.slice(0, 5).join('; ') }) : ''].filter(Boolean).join(' '),
    ...(done === 0 ? { error: failed.join('; ').slice(0, 200) || 'failed' } : {}),
    href: one ? `/app/lines/inbox/${one}` : '/app/lines/inbox',
    ...(drafts.length ? { drafts } : {}),
  };
}

export const chatActionTools: AssistantTool[] = [
  readTool({
    name: 'lines_find_chats',
    app: 'groups',
    description:
      'Find Lines chats (the shared WhatsApp lines of the workspace) by contact or group name or phone, only among the chats this person can see. It matches names (and phones, if the person sees them), never message text. List data only (name, line, assignment, unread, last activity), so it needs no permission. Use it to get the chat id before reading or acting on a chat; when several chats look alike, ask the person which one.',
    input: findInput,
    // Los nombres los escriben otros (nombre de WhatsApp, asunto del grupo): van marcados como datos.
    run: async (ctx, { query, limit }: z.infer<typeof findInput>) => ({ chats: wrapUntrusted('lines.find', await linesFind(ctx, query, limit ?? 8)) }),
  }),
  readTool({
    name: 'inbox_find_chats',
    app: 'inbox',
    description: "Find chats in the person's own Inbox (WhatsApp and email) by name, phone or email. List data only, no message text, so it needs no permission.",
    input: findInput,
    run: async (ctx, { query, limit }: z.infer<typeof findInput>) => {
      if (delegatedIdentity()) return { error: 'not_available_here' };
      return { chats: wrapUntrusted('inbox.find', await inboxFind(ctx.personId, query, limit ?? 8)) };
    },
  }),
  writeTool({
    name: 'propose_lines_actions',
    app: 'groups',
    description:
      'Prepare changes to Lines chats the person can see, all in ONE card: a reply draft put in the message field (never sent), assign to a teammate or team, add a label, close, archive, an internal note, a task, a ticket, or a WhatsApp message scheduled for a future time (for a broadcast, one schedule row per chat). Each row shows what, where and the text. Nothing changes and nothing is sent until the person clicks Confirm; a scheduled message goes out on WhatsApp at its time, so say that when you propose it.',
    input: linesInput,
    prepare: async (ctx, input: z.infer<typeof linesInput>) => prepareLines(ctx, input),
    execute: async (ctx, raw) => executeLines(ctx, raw),
  }),
];
