'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatDto, GroupsPerson, LabelDto, MessageDto } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import type { SlashCommand, SlashOption } from '@/lib/slash-commands';
import type { AiCompose } from '@/components/ai/useAiCompose';
import { useAiSlashCommands } from '@/components/ai/slash-commands';
import { ArchiveIcon, CheckCircle, ClockIcon, DocIcon, GroupIcon, Lock, MuteIcon, Note, Panel, Person, PinIcon, PollIcon, Retry, SendIcon, Smiley, Sparkle, Ticket, UserPlus } from './wa/icons';

/**
 * Lo que el hilo de Lines ya sabe hacer, para armar sus comandos con "/".
 * Cada handler es el mismo que llama el botón o el menú del hilo: los
 * comandos no agregan permisos ni rutas. Las listas (personas, equipos,
 * etiquetas) son las que el servidor ya le mandó a esta persona.
 */
export interface LinesSlashContext {
  chat: ChatDto;
  me: string;
  people: GroupsPerson[];
  teams: Array<{ id: string; name: string }>;
  labels: LabelDto[];
  caps: ProviderCaps;
  mode: 'reply' | 'note';
  messages: MessageDto[];
  translateOn: boolean;
  /** "Ayudame a escribir", o null si acá no se ofrece (nota interna, edición). */
  ai: AiCompose | null;
  patchChat: (body: Record<string, unknown>) => unknown;
  setMode: (mode: 'reply' | 'note') => void;
  openTicket: (m: MessageDto) => void;
  openTask: (m: MessageDto) => void;
  openLater: () => void;
  attach: () => void;
  openPoll: () => void;
  openContact: () => void;
  openEmoji: () => void;
  toggleMute: () => void;
  toggleUnread: () => void;
  toggleArchived: () => void;
  summarize: () => void;
  toggleTranslate: () => void;
  toggleDetails: () => void;
  manageQuickReplies: () => void;
}

/** Palabras sueltas de una cadena de mensajes ("dueño persona agente"). */
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Comandos de Lines. El nombre va en el idioma de la persona; el nombre en
 * inglés (el id) siempre funciona como alias.
 */
export function useLinesSlashCommands(ctx: LinesSlashContext): SlashCommand[] {
  const t = useTranslations('groups.slash');
  const tg = useTranslations('groups');
  const aiCommands = useAiSlashCommands(ctx.ai);
  const { chat, mode } = ctx;
  const reply = mode === 'reply';
  const out: SlashCommand[] = [];

  const add = (id: string, run: SlashCommand['run'], extra: Partial<SlashCommand> & { aliases?: string[]; key?: string } = {}) => {
    const { key = id, aliases = [], ...rest } = extra;
    out.push({
      id,
      name: t(`${key}.name`),
      description: t(`${key}.desc`),
      keywords: words(t(`${key}.keys`)),
      aliases: [id, ...aliases],
      section: 'actions',
      run,
      ...rest,
    });
  };
  const icon = (node: ReactNode) => ({ icon: node });

  // --- Asignación: la misma lista de personas que el selector del encabezado.
  if (ctx.people.length > 0) {
    add('assign', (o) => o && void ctx.patchChat({ assignedTo: o.id === '' ? null : o.id }), {
      ...icon(<UserPlus size={18} />),
      emptyText: t('assign.empty'),
      args: () => {
        const mine = ctx.people.find((p) => p.id === ctx.me);
        const person = (p: GroupsPerson): SlashOption => ({
          id: p.id,
          label: p.name || p.email,
          hint: p.id === ctx.me ? t('assign.you') : p.name ? p.email : undefined,
          keywords: p.id === ctx.me ? ['me', ...words(t('assign.meKeys'))] : undefined,
          checked: chat.assignedTo === p.id,
        });
        return [
          ...(mine ? [person(mine)] : []),
          ...ctx.people.filter((p) => p.id !== ctx.me).map(person),
          { id: '', label: tg('thread.unassigned'), keywords: ['nobody', 'none', 'unassign', ...words(t('assign.nobodyKeys'))], checked: !chat.assignedTo },
        ];
      },
    });
  }
  if (ctx.teams.length > 0) {
    add('team', (o) => o && void ctx.patchChat({ assignedTeamId: o.id === '' ? null : o.id }), {
      ...icon(<GroupIcon size={18} />),
      emptyText: t('team.empty'),
      args: () => [
        ...ctx.teams.map((tm) => ({ id: tm.id, label: tm.name, checked: chat.assignedTeamId === tm.id })),
        { id: '', label: tg('thread.noTeam'), keywords: ['none', ...words(t('team.noneKeys'))], checked: !chat.assignedTeamId },
      ],
    });
  }
  if (chat.status === 'open') add('close', () => void ctx.patchChat({ status: 'closed' }), { shortcut: 'E', aliases: ['done', 'resolve'], ...icon(<CheckCircle size={18} />) });
  else add('reopen', () => void ctx.patchChat({ status: 'open' }), { shortcut: 'E', aliases: ['open'], ...icon(<Retry size={18} />) });

  // --- Etiquetas: las que esta persona ve; elegir una la pone o la saca (igual que el panel de detalles).
  if (ctx.labels.length > 0) {
    add(
      'label',
      (o) => {
        if (!o) return;
        const ids = chat.labels.map((l) => l.id);
        void ctx.patchChat({ labelIds: ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id] });
      },
      {
        aliases: ['tag', 'labels'],
        emptyText: t('label.empty'),
        args: () => ctx.labels.map((l) => ({ id: l.id, label: l.name, color: l.color, checked: chat.labels.some((x) => x.id === l.id) })),
      },
    );
  }

  if (reply) add('note', () => ctx.setMode('note'), { shortcut: 'N', aliases: ['internal'], ...icon(<Lock size={18} />) });
  else add('reply', () => ctx.setMode('reply'), { shortcut: 'R', aliases: ['whatsapp'], ...icon(<SendIcon size={18} />) });

  const lastIn = [...ctx.messages].reverse().find((m) => m.direction === 'in');
  const lastAny = [...ctx.messages].reverse().find((m) => m.direction === 'in' || m.direction === 'out');
  if (lastIn) add('ticket', () => ctx.openTicket(lastIn), { shortcut: 'T', ...icon(<Ticket size={18} />) });
  if (lastAny) add('task', () => ctx.openTask(lastAny), { aliases: ['todo'], ...icon(<Note size={18} />) });

  if (reply) {
    add('later', ctx.openLater, { aliases: ['schedule'], ...icon(<ClockIcon size={18} />) });
    add('attach', ctx.attach, { aliases: ['file', 'document'], ...icon(<DocIcon size={18} />) });
    add('poll', ctx.openPoll, icon(<PollIcon size={18} />));
    if (ctx.caps.contacts) add('contact', ctx.openContact, icon(<Person size={18} />));
  }
  add('emoji', ctx.openEmoji, icon(<Smiley size={18} />));

  add(chat.muted ? 'unmute' : 'mute', ctx.toggleMute, { aliases: chat.muted ? [] : ['silence'], ...icon(<MuteIcon size={18} />) });
  add(chat.pinned ? 'unpin' : 'pin', () => void ctx.patchChat({ pinned: !chat.pinned }), { shortcut: 'P', ...icon(<PinIcon size={18} />) });
  add(chat.archived ? 'unarchive' : 'archive', ctx.toggleArchived, icon(<ArchiveIcon size={18} />));
  add(chat.unread > 0 ? 'read' : 'unread', ctx.toggleUnread, { shortcut: 'U' });
  add('summary', ctx.summarize, { aliases: ['summarize', 'tldr'], ...icon(<Sparkle size={18} />) });
  // Traducir: los mensajes del cliente (lo del menú del chat, L) o, con AI, lo que se escribió (los idiomas de la barra).
  const aiTranslate = aiCommands.find((c) => c.id === 'translate');
  add(
    'translate',
    (o) => {
      if (!o) return;
      if (o.id === 'chat') ctx.toggleTranslate();
      else aiTranslate?.run(o);
    },
    {
      aliases: ['language'],
      emptyText: t('translate.empty'),
      args: (env) => [
        { id: 'chat', label: t('translate.chat'), hint: 'L', keywords: words(t('translate.chatKeys')), checked: ctx.translateOn },
        ...(aiTranslate?.args && env.rest.trim() ? aiTranslate.args(env).map((o) => ({ ...o, hint: t('translate.yours') })) : []),
      ],
    },
  );
  add('details', ctx.toggleDetails, { aliases: ['info'], ...icon(<Panel size={18} />) });
  add('quick-replies', ctx.manageQuickReplies, { key: 'quick', aliases: ['replies', 'snippets'] });

  // AI: lo mismo que la barra "Ayudame a escribir" (nunca manda: deja un borrador para revisar).
  return [...out, ...aiCommands.filter((c) => c !== aiTranslate)];
}
