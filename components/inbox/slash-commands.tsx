'use client';

import { useTranslations } from 'next-intl';
import type { ThreadDto } from '@/lib/inbox/types';
import type { SlashCommand } from '@/lib/slash-commands';
import { Bell, CheckCircle, ClockIcon, DocIcon, FolderIcon, Mic, MuteIcon, Note, ArchiveIcon, Person, PinIcon, Retry, Smiley } from '@/components/groups/wa/icons';

/** Palabras sueltas de una cadena de mensajes ("terminar listo resolver"). */
const words = (s: string) => s.split(/\s+/).filter(Boolean);

type Extra = Partial<Pick<SlashCommand, 'shortcut' | 'icon' | 'args' | 'emptyText'>> & { aliases?: string[]; key?: string };

function useAdd() {
  const t = useTranslations('inbox.slash');
  const make = (id: string, run: SlashCommand['run'], extra: Extra = {}): SlashCommand => {
    const { key = id, aliases = [], ...rest } = extra;
    return { id, name: t(`${key}.name`), description: t(`${key}.desc`), keywords: words(t(`${key}.keys`)), aliases: [id, ...aliases], section: 'actions', run, ...rest };
  };
  return { t, make };
}

/**
 * Comandos "/" del chat abierto en Inbox (WhatsApp o correo): las mismas
 * acciones de la cabecera y del menú "…". `onAction` es el de esos botones;
 * nada pasa por otro camino.
 */
export function useInboxThreadCommands(ctx: {
  thread: ThreadDto;
  onAction: (action: string) => void;
  /** Solo en la conversación de WhatsApp. */
  openNotes?: () => void;
  openInfo?: () => void;
  rename?: () => void;
  /** Abre el selector de archivos (con WhatsApp conectado). */
  attach?: () => void;
}): SlashCommand[] {
  const { t, make } = useAdd();
  const { thread, onAction } = ctx;
  const act = (name: string) => () => onAction(name);
  const out: SlashCommand[] = [];
  if (thread.done) out.push(make('undone', act('undone'), { shortcut: '⇧E', aliases: ['inbox', 'reopen'], icon: <Retry size={18} /> }));
  else out.push(make('done', act('done'), { shortcut: 'E', aliases: ['close', 'resolve'], icon: <CheckCircle size={18} /> }));
  out.push(make('snooze', act('snooze'), { shortcut: 'H', aliases: ['postpone'], icon: <ClockIcon size={18} /> }));
  if (thread.snoozedUntil) out.push(make('unsnooze', act('unsnooze')));
  out.push(make('remind', act('followUp'), { shortcut: 'F', aliases: ['followup', 'follow-up', 'reminder'], icon: <Bell size={18} /> }));
  if (thread.followUpAt) out.push(make('clear-reminder', act('clearFollowUp'), { key: 'clearReminder' }));
  out.push(make('folder', act('move'), { shortcut: 'V', aliases: ['move'], icon: <FolderIcon size={18} /> }));
  if (ctx.openNotes) out.push(make('notes', ctx.openNotes, { aliases: ['note'], icon: <Note size={18} /> }));
  out.push(make(thread.unread > 0 ? 'read' : 'unread', act('unread'), { shortcut: 'U' }));
  out.push(make(thread.pinned ? 'unpin' : 'pin', act('pin'), { shortcut: 'P', icon: <PinIcon size={18} /> }));
  out.push(make(thread.archived ? 'unarchive' : 'archive', act(thread.archived ? 'unarchive' : 'archive'), { icon: <ArchiveIcon size={18} /> }));
  if (thread.mutedUntil) out.push(make('unmute', act('unmute'), { icon: <MuteIcon size={18} /> }));
  else {
    out.push(
      make('mute', (o) => o && onAction(o.id), {
        aliases: ['silence'],
        icon: <MuteIcon size={18} />,
        emptyText: t('mute.empty'),
        args: () => [
          { id: 'mute8h', label: t('mute.hours8'), keywords: ['8', '8h', 'hours', ...words(t('mute.hours8Keys'))] },
          { id: 'muteWeek', label: t('mute.week'), keywords: ['7', 'week', ...words(t('mute.weekKeys'))] },
        ],
      }),
    );
  }
  if (ctx.openInfo) out.push(make('info', ctx.openInfo, { aliases: ['details', 'contact'], icon: <Person size={18} /> }));
  if (ctx.rename) out.push(make('rename', ctx.rename));
  if (ctx.attach) out.push(make('attach', ctx.attach, { aliases: ['file', 'photo', 'document'], icon: <DocIcon size={18} /> }));
  return out;
}

/** Comandos "/" del campo de Inbox: enviar más tarde, emojis y dictar (los botones del propio campo). */
export function useInboxComposerCommands(ctx: { onLater?: () => void; openEmoji?: () => void; dictate: () => void }): SlashCommand[] {
  const { make } = useAdd();
  const out: SlashCommand[] = [];
  if (ctx.onLater) out.push(make('later', ctx.onLater, { shortcut: '⌘⇧Enter', aliases: ['schedule'], icon: <ClockIcon size={18} /> }));
  if (ctx.openEmoji) out.push(make('emoji', ctx.openEmoji, { icon: <Smiley size={18} /> }));
  out.push(make('dictate', ctx.dictate, { aliases: ['voice'], icon: <Mic size={18} /> }));
  return out;
}
