'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import NewChatPanel, { type NewChatAction } from '@/components/groups/wa/NewChatPanel';
import { GroupIcon } from '@/components/groups/wa/icons';
import Icon from '@/components/app/icons';
import type { InboxAccountDto, ThreadDto } from '@/lib/inbox/types';
import type { NewChatDirectory, NewChatEntry } from '@/lib/wa-new-chat';
import { api } from './api';

/**
 * "Chat nuevo" de Inbox: el mismo panel que Lines sobre la cuenta de WhatsApp
 * de la persona. Elegir un contacto abre su chat (el que ya existe o uno
 * nuevo), "Mandate un mensaje" abre el chat con el propio número, "Grupo
 * nuevo" crea un grupo de WhatsApp acá mismo y "Correo nuevo" (con Gmail
 * conectado) abre el correo de siempre.
 */
export default function InboxNewChat({
  open,
  accounts,
  onClose,
  onOpen,
  onCreated,
  onNewEmail,
  errText,
}: {
  open: boolean;
  accounts: InboxAccountDto[];
  onClose: () => void;
  /** Un chat que ya existe. */
  onOpen: (threadId: string) => void;
  /** Un chat recién creado (o traído): va arriba de la lista y se abre. */
  onCreated: (thread: ThreadDto) => void;
  onNewEmail: () => void;
  errText: (code?: string) => string;
}) {
  const t = useTranslations('inboxWa.newChat');
  const wa = accounts.find((a) => a.kind === 'whatsapp');
  const connected = wa?.status === 'connected';
  const gmail = accounts.some((a) => a.kind === 'gmail' && a.status === 'connected');

  const load = useCallback(async ({ q, cursor, signal }: { q: string; cursor: string | null; signal: AbortSignal }): Promise<NewChatDirectory | null> => {
    const params = new URLSearchParams({ q });
    if (cursor) params.set('cursor', cursor);
    const r = await api<NewChatDirectory>(`/api/inbox/contacts?${params}`, { signal });
    return r.ok ? r.data : null;
  }, []);

  const start = useCallback(
    async (phone: string): Promise<string | null> => {
      const r = await api<{ thread: ThreadDto }>('/api/inbox/compose', { method: 'POST', json: { channel: 'whatsapp', to: phone } });
      if (!r.ok) return errText(r.data.error);
      onCreated(r.data.thread);
      return null;
    },
    [errText, onCreated],
  );

  const createGroup = useCallback(
    async (name: string, phones: string[]): Promise<string | null> => {
      const r = await api<{ thread: ThreadDto }>('/api/inbox/groups', { method: 'POST', json: { name, phones } });
      if (!r.ok) return errText(r.data.error);
      onCreated(r.data.thread);
      return null;
    },
    [errText, onCreated],
  );

  const actions = useMemo<NewChatAction[]>(
    () => [
      ...(connected ? [{ key: 'group', label: t('newGroup'), icon: <GroupIcon size={20} />, group: true }] : []),
      ...(gmail ? [{ key: 'email', label: t('newEmail'), icon: <Icon name="inbox" size={18} />, onSelect: onNewEmail }] : []),
    ],
    [connected, gmail, t, onNewEmail],
  );

  return (
    <NewChatPanel
      open={open}
      onClose={onClose}
      sourceKey={wa?.id ?? 'none'}
      load={load}
      canStart={connected}
      actions={actions}
      createGroup={connected ? createGroup : undefined}
      onPick={async (e: NewChatEntry) => {
        if (e.chatId) {
          onOpen(e.chatId);
          return null;
        }
        return start(e.phone);
      }}
      onPhone={start}
      notice={
        wa && !connected ? (
          <p className="wa-nc-msg ui-error" role="alert">
            {t('accountOff')}
          </p>
        ) : null
      }
    />
  );
}
