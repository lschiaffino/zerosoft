/**
 * El asistente actúa sobre Lines e Inbox, siempre con tarjeta de aprobación.
 *
 * - lines_find_chats / inbox_find_chats: buscar un chat por nombre o teléfono. Solo datos de la lista (nombre,
 *   línea, asignación, no leídos, última actividad), nunca el texto de un mensaje: no piden permiso. Lines con el
 *   acceso por línea, etiqueta y asignación de quien pide (y los teléfonos ocultos si no los ve); Inbox, solo los
 *   chats de la persona.
 * - propose_lines_actions: en una sola tarjeta, borrador de respuesta (va al campo del chat, no se manda), asignar,
 *   nota interna, tarea y mensaje programado. Cada fila dice qué, dónde y el texto. Un programado sale a WhatsApp a
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
import { chatDisplayName, getChatRow, getNumberRow, listChats, listPeople, sendMessage, type ChatRow } from '../groups';
import { canSeeChat, groupsViewer, maskChat, maskPhone, type GroupsViewer } from '../groups-access';
import enMessages from '../../messages/en/assistant.json';
import esMessages from '../../messages/es/assistant.json';
import ptMessages from '../../messages/pt/assistant.json';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

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

const fmtUtc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

// ---------------------------------------------------------------------------
// Buscar chats
// ---------------------------------------------------------------------------

const findInput = z.object({
  query: z.string().trim().min(1).max(120).describe('Part of the chat name, the contact name or the phone number.'),
  limit: z.number().int().min(1).max(20).optional(),
});

async function linesFind(ctx: ToolCtx, query: string, limit: number) {
  const viewer = await groupsViewer(ctx.workspaceId, ctx.personId, ctx.user.role);
  const now = Date.now();
  const { rows } = await listChats(ctx.workspaceId, ctx.personId, { q: query, limit, viewer, count: false } as Parameters<typeof listChats>[2]);
  return rows.map((c) => {
    const m = maskChat(viewer, c);
    return {
      id: m.id,
      name: m.name,
      group: m.kind === 'group',
      unread: m.unread,
      lastMessageAt: m.lastMessageAt,
      ...(m.awaitingSince ? { waitingHours: hoursSince(m.awaitingSince, now) } : {}),
      assigned: m.assignedTo ? (m.assignedTo === ctx.personId ? 'me' : 'someone else') : 'nobody',
      href: `/app/lines/inbox/${m.id}`,
    };
  });
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

export const LINES_ACTIONS = ['draft', 'assign', 'note', 'task', 'schedule'] as const;
type LinesDo = (typeof LINES_ACTIONS)[number];

const linesInput = z.object({
  actions: z
    .array(
      z.object({
        chat: z.string().trim().min(1).max(120).describe('Chat id from lines_find_chats or lines_attention (or its exact name).'),
        do: z
          .enum(LINES_ACTIONS)
          .describe(
            'draft: put a reply in the message field of the chat for the person to review (nothing is sent). assign: assign the chat to a person or team. note: internal note only the team sees. task: a task linked to the chat. schedule: a WhatsApp message sent at a future time.',
          ),
        text: z.string().max(4000).optional().describe('draft / note / schedule: the text, in the language of the chat. task: the task title.'),
        to: z.string().max(200).optional().describe('assign: "me", a teammate name or email, or a team name. task: who owns the task (default: me).'),
        at: z.string().max(40).optional().describe('schedule: ISO date-time in the future when the message goes out. task: due date (optional).'),
      }),
    )
    .min(1)
    .max(MAX_ACTIONS),
});

export interface LinesPlanned {
  chatId: string;
  name: string;
  do: LinesDo;
  text?: string;
  /** assign: persona o equipo. task: dueña. */
  personId?: string;
  teamId?: string;
  who?: string;
  at?: string;
  line?: string;
}

/** Un chat por id o por nombre, solo entre los que quien pide ve. */
async function resolveLinesChat(ctx: ToolCtx, viewer: GroupsViewer, ref: string): Promise<ChatRow | null> {
  if (await canSeeChat(viewer, ref)) return getChatRow(ctx.workspaceId, ref);
  const found = await listChats(ctx.workspaceId, ctx.personId, { q: ref, limit: 1, viewer, count: false } as Parameters<typeof listChats>[2]);
  return found.rows[0] ? getChatRow(ctx.workspaceId, found.rows[0].id) : null;
}

/** "me", un nombre o un email del workspace (uno solo), o el nombre de un equipo de Lines. */
async function resolveAssignee(ctx: ToolCtx, ref: string): Promise<{ personId?: string; teamId?: string; who: string } | null> {
  const r = ref.trim().toLowerCase();
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
  for (const a of input.actions) {
    const chat = await resolveLinesChat(ctx, viewer, a.chat);
    if (!chat) {
      problems.push(`${a.chat}: chat_not_found`);
      continue;
    }
    const name = maskChat(viewer, { name: chatDisplayName(chat), phone: chat.phone }).name;
    const p: LinesPlanned = { chatId: chat.id, name, do: a.do };
    const text = a.text?.trim();
    if (a.do === 'draft' || a.do === 'note' || a.do === 'schedule' || a.do === 'task') {
      if (!text) {
        problems.push(`${name}: ${a.do} needs text`);
        continue;
      }
      p.text = text.slice(0, a.do === 'task' ? 200 : 4000);
    }
    if (a.do === 'assign') {
      const who = a.to ? await resolveAssignee(ctx, a.to) : null;
      if (!who) {
        problems.push(`${name}: assign needs a teammate or team that exists (${a.to ?? ''})`);
        continue;
      }
      Object.assign(p, who);
      const cur = (await getDb().prepare('SELECT assigned_to, assigned_team_id FROM groups_chats WHERE id = ?').get(chat.id)) as { assigned_to: string | null; assigned_team_id: string | null } | undefined;
      const people = await listPeople(ctx.workspaceId);
      const curName = cur?.assigned_to ? (people.find((x) => x.id === cur.assigned_to)?.name ?? '') : '';
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
          problems.push(`${name}: task due date must be in the future`);
          continue;
        }
        p.at = due;
      }
    }
    if (a.do === 'schedule') {
      const at = futureAt(a.at, now, SCHEDULE_MIN_LEAD_MS);
      if (!at) {
        problems.push(`${name}: schedule needs a future date-time in at (at least a minute from now)`);
        continue;
      }
      const number = await getNumberRow(ctx.workspaceId, chat.number_id);
      if (!number || number.status !== 'connected' || chat.left_at) {
        problems.push(`${name}: the line of this chat is not connected`);
        continue;
      }
      p.at = at;
      p.line = number.name || (number.phone ? (viewer.mask ? maskPhone(number.phone) : `+${number.phone}`) : '');
    }
    planned.push(p);
  }
  if (!planned.length) return { error: 'nothing_to_do', hint: problems };
  const details = planned.map((p) => {
    switch (p.do) {
      case 'draft':
        return { label: t('do.draft', { chat: p.name }), after: p.text! };
      case 'note':
        return { label: t('do.note', { chat: p.name }), after: p.text! };
      case 'assign':
        return { label: t('do.assign', { chat: p.name }), before: before.get(p.chatId) ?? null, after: p.who! };
      case 'task':
        return { label: t('do.task', { chat: p.name }), after: [p.text!, p.at ? t('due', { when: fmtUtc(p.at) }) : '', p.who ? t('owner', { who: p.who }) : ''].filter(Boolean).join('\n') };
      case 'schedule':
        return { label: t('do.schedule', { chat: p.name, when: fmtUtc(p.at!), line: p.line ?? '' }), after: p.text! };
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
    forModel: { planned: planned.map((p) => ({ chat: p.name, do: p.do, ...(p.at ? { at: p.at } : {}), ...(p.who ? { to: p.who } : {}) })), ...(problems.length ? { skipped: problems } : {}) },
  };
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
      } else if (p.do === 'task') {
        const { createGroupTask } = await import('../groups-tasks');
        await createGroupTask(ctx.workspaceId, ctx.personId, { chatId: p.chatId, title: String(p.text ?? ''), dueAt: p.at ?? null, ownerId: p.personId ?? null, locale: ctx.locale }, new Date(), viewer);
      } else if (p.do === 'schedule') {
        // La hora se vuelve a mirar al confirmar: si ya pasó (o falta menos de un minuto) no se programa, así nunca sale en el acto.
        if (!futureAt(p.at, Date.now(), SCHEDULE_MIN_LEAD_MS / 2)) throw new Error('time_passed');
        const chat = await getChatRow(ctx.workspaceId, p.chatId);
        if (!chat) throw new Error('not_found');
        const { createBroadcast } = await import('../groups-broadcasts');
        await createBroadcast(ctx.workspaceId, ctx.personId, { numberId: chat.number_id, name: '', body: String(p.text ?? ''), media: null, chatIds: [p.chatId], poll: null, replyToId: null, mentions: null, scheduledAt: p.at!, kind: 'scheduled' });
      }
      done++;
    } catch (err) {
      failed.push(`${p.name} (${err instanceof Error ? (err as { code?: string }).code || err.message : 'error'})`);
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
      'Find Lines chats (the shared WhatsApp lines of the workspace) by contact or group name or phone, only among the chats this person can see. List data only (name, assignment, unread, last activity), no message text, so it needs no permission. Use it to get the chat id before reading or acting on a chat.',
    input: findInput,
    run: async (ctx, { query, limit }: z.infer<typeof findInput>) => ({ chats: await linesFind(ctx, query, limit ?? 8) }),
  }),
  readTool({
    name: 'inbox_find_chats',
    app: 'inbox',
    description: "Find chats in the person's own Inbox (WhatsApp and email) by name, phone or email. List data only, no message text, so it needs no permission.",
    input: findInput,
    run: async (ctx, { query, limit }: z.infer<typeof findInput>) => {
      if (delegatedIdentity()) return { error: 'not_available_here' };
      return { chats: await inboxFind(ctx.personId, query, limit ?? 8) };
    },
  }),
  writeTool({
    name: 'propose_lines_actions',
    app: 'groups',
    description:
      'Prepare changes to Lines chats the person can see, all in ONE card: a reply draft put in the message field (never sent), assign to a teammate or team, an internal note, a task, or a WhatsApp message scheduled for a future time. Each row shows what, where and the text. Nothing changes and nothing is sent until the person clicks Confirm; a scheduled message goes out on WhatsApp at its time, so say that when you propose it.',
    input: linesInput,
    prepare: async (ctx, input: z.infer<typeof linesInput>) => prepareLines(ctx, input),
    execute: async (ctx, raw) => executeLines(ctx, raw),
  }),
];
