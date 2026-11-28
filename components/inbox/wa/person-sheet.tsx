'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ContactSheet, { type SheetSharedItem } from '@/components/groups/wa/ContactSheet';
import type { WaPersonCard } from '@/lib/wa-person';
import { api } from '../api';
import { formatPhone } from './util';

interface SharedRow {
  id: string;
  mediaType: string;
  mediaName: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  urls?: string[];
}

/**
 * Inbox: la ficha "Info del contacto" de una persona de un grupo (al tocar su
 * foto o su nombre en un mensaje, o en la lista de participantes). Trae la
 * ficha del grupo abierto y hace las acciones con las rutas de Inbox:
 * Mensaje (abre o crea el chat 1:1), silenciar y bloquear ese chat, lo
 * compartido y los destacados, y abrir un grupo en común.
 */
export function useInboxPersonSheet(
  groupId: string,
  opts: {
    onOpenThread?: (id: string) => void;
    onStartChat?: (phone: string) => Promise<void>;
    onError: (code: string) => void;
    onToast: (text: string) => void;
    /** Algo de la ficha cambió el chat (marcar a alguien como interno): se vuelve a leer la conversación. */
    onChanged?: () => void;
  },
): { open: (phone: string, name: string, picture?: string) => void; sheet: ReactNode } {
  const t = useTranslations('groups.wa.contactSheet');
  const w = useTranslations('inboxWa');
  const [person, setPerson] = useState<{ phone: string; name: string; picture?: string } | null>(null);
  const [card, setCard] = useState<WaPersonCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { onOpenThread, onStartChat, onError, onToast, onChanged } = opts;
  const ti = useTranslations('groups.wa.internal');

  const load = useCallback(
    async (phone: string) => {
      setError('');
      const r = await api<{ person: WaPersonCard }>(`/api/inbox/threads/${groupId}/wa?part=person&phone=${encodeURIComponent(phone)}`);
      if (r.ok) setCard(r.data.person);
      else setError(t('loadFailed'));
    },
    [groupId, t],
  );

  useEffect(() => setPerson(null), [groupId]);

  const open = useCallback(
    (phone: string, name: string, picture?: string) => {
      if (!/^\d{8,15}$/.test(phone)) return;
      setPerson({ phone, name, picture });
      setCard(null);
      void load(phone);
    },
    [load],
  );

  const dmId = card?.dm?.id ?? '';
  const loadShared = useCallback(
    async (kind: 'media' | 'docs' | 'links' | 'starred'): Promise<SheetSharedItem[] | null> => {
      if (!dmId) return [];
      const r = await api<{ items: SharedRow[] }>(`/api/inbox/threads/${dmId}/wa?kind=${kind}`);
      if (!r.ok) return null;
      return r.data.items.map((m) => ({
        id: m.id,
        url: ['image', 'video', 'document'].includes(m.mediaType) ? `/api/inbox/media/${m.id}` : '',
        video: m.mediaType === 'video',
        name: m.mediaName,
        body: m.body,
        sentAt: m.sentAt,
        fromMe: m.fromMe,
        senderName: m.senderName,
        ...(m.urls ? { urls: m.urls } : {}),
      }));
    },
    [dmId],
  );

  const label = card ? card.name || formatPhone(card.phone) : (person?.name ?? '');
  const sheet = person ? (
    <ContactSheet
      card={card}
      error={error}
      fallbackName={person.name}
      fallbackPicture={person.picture}
      busy={busy}
      onClose={() => setPerson(null)}
      onRetry={() => void load(person.phone)}
      onMessage={async () => {
        if (card?.dm) {
          setPerson(null);
          onOpenThread?.(card.dm.id);
          return;
        }
        setBusy(true);
        await onStartChat?.(person.phone);
        setBusy(false);
        setPerson(null);
      }}
      onOpenGroup={(id) => {
        setPerson(null);
        onOpenThread?.(id);
      }}
      onMute={
        card?.dm
          ? async (on) => {
              const until = on ? new Date(Date.now() + 1000 * 86_400_000).toISOString() : null;
              const r = await api(`/api/inbox/threads/${card.dm!.id}`, { method: 'PATCH', json: { action: 'mute', until } });
              if (!r.ok) onError(r.data.error ?? 'generic');
              void load(person.phone);
            }
          : undefined
      }
      onBlock={async (on) => {
        if (!card?.dm) return;
        const r = await api(`/api/inbox/threads/${card.dm.id}/wa`, { method: 'POST', json: { action: on ? 'block' : 'unblock' } });
        if (!r.ok) onError(r.data.error ?? 'generic');
        else onToast(on ? w('blocked', { name: label }) : w('unblocked', { name: label }));
        void load(person.phone);
      }}
      onInternal={
        card?.canMarkInternal && card.phone
          ? async (on) => {
              // Interno o no (lib/internal-contacts.ts), en el workspace activo. Apagarlo es "no interno".
              const r = await api('/api/inbox/internal', { method: 'POST', json: { handle: card.phone, internal: on } });
              if (!r.ok) return onError(r.data.error ?? 'generic');
              onToast(on ? ti('markedToast', { name: label }) : ti('unmarkedToast', { name: label }));
              void load(person.phone);
              onChanged?.();
            }
          : undefined
      }
      loadShared={loadShared}
    />
  ) : null;
  return { open, sheet };
}
