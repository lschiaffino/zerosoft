'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ContactSheet, { type SheetSharedItem } from './wa/ContactSheet';
import { formatWaPhone } from './wa/format';
import type { WaPersonCard } from '@/lib/wa-person';
import { api } from './ui';

/** A quién se abre: por teléfono (miembros) o por un mensaje suyo (sirve también con los teléfonos ocultos). */
export type PersonRef = { phone: string; messageId?: undefined } | { messageId: string; phone?: undefined };

interface SharedRow {
  id: string;
  url: string;
  mime: string;
  name: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  urls?: string[];
}

/** La persona en la URL: ?message=<id> o ?phone=<dígitos>. */
const query = (ref: PersonRef) => (ref.messageId ? `message=${encodeURIComponent(ref.messageId)}` : `phone=${encodeURIComponent(ref.phone ?? '')}`);

/**
 * Lines: la ficha "Info del contacto" de una persona de un grupo (al tocar su
 * foto o su nombre en un mensaje, o un miembro de la lista). Mensaje abre (o
 * crea) su chat 1:1 en la misma línea; silenciar y bloquear ese chat, lo
 * compartido y los destacados, y los grupos en común de la línea.
 */
export function useLinesPersonSheet(groupId: string, onError: (code: string) => void, onToast?: (text: string) => void): { open: (ref: PersonRef, name: string, picture?: string) => void; sheet: ReactNode } {
  const t = useTranslations('groups.wa.contactSheet');
  const router = useRouter();
  const [person, setPerson] = useState<{ ref: PersonRef; name: string; picture?: string } | null>(null);
  const [card, setCard] = useState<(WaPersonCard & { masked?: boolean }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (ref: PersonRef) => {
      setError('');
      const r = await api<{ person: WaPersonCard & { masked?: boolean } }>(`/api/groups/chats/${groupId}/members?${query(ref)}`);
      if (r.data) setCard(r.data.person);
      else setError(t('loadFailed'));
    },
    [groupId, t],
  );

  useEffect(() => setPerson(null), [groupId]);

  const open = useCallback(
    (ref: PersonRef, name: string, picture?: string) => {
      setPerson({ ref, name, picture });
      setCard(null);
      void load(ref);
    },
    [load],
  );

  const ref = person?.ref;
  const loadShared = useCallback(
    async (kind: 'media' | 'docs' | 'links' | 'starred'): Promise<SheetSharedItem[] | null> => {
      if (!ref) return [];
      const r = await api<{ items: SharedRow[] }>(`/api/groups/chats/${groupId}/members?${query(ref)}&shared=${kind}`);
      if (!r.data) return null;
      return r.data.items.map((m) => ({
        id: m.id,
        url: m.url,
        video: m.mime.startsWith('video/'),
        name: m.name,
        body: m.body,
        sentAt: m.sentAt,
        fromMe: m.fromMe,
        senderName: m.senderName,
        ...(m.urls ? { urls: m.urls } : {}),
      }));
    },
    [groupId, ref],
  );

  const go = (chatId: string) => {
    setPerson(null);
    router.push(`/app/lines/inbox/${chatId}${typeof window !== 'undefined' ? window.location.search : ''}`);
  };

  const label = card ? card.name || formatWaPhone(card.phone, card.masked) : (person?.name ?? '');
  const sheet = person ? (
    <ContactSheet
      card={card}
      error={error}
      fallbackName={person.name}
      fallbackPicture={person.picture}
      busy={busy}
      onClose={() => setPerson(null)}
      onRetry={() => void load(person.ref)}
      onMessage={async () => {
        if (card?.dm) return go(card.dm.id);
        setBusy(true);
        const r = await api<{ id: string }>(`/api/groups/chats/${groupId}/members`, { body: { action: 'message', ...person.ref } });
        setBusy(false);
        if (r.data?.id) go(r.data.id);
        else onError(r.error ?? 'server_error');
      }}
      onOpenGroup={go}
      onMute={
        card?.dm
          ? async (on) => {
              const r = await api(`/api/groups/chats/${card.dm!.id}`, { method: 'PATCH', body: { muted: on } });
              if (!r.data) onError(r.error);
              void load(person.ref);
            }
          : undefined
      }
      onBlock={async (on) => {
        if (!card?.dm) return;
        // En WhatsApp, por el adaptador de la línea (Evolution); la ficha se vuelve a leer para mostrar Desbloquear.
        const r = await api(`/api/groups/chats/${card.dm.id}`, { body: { action: on ? 'block' : 'unblock' } });
        if (!r.data) onError(r.error);
        else onToast?.(on ? t('blockedToast', { name: label }) : t('unblockedToast', { name: label }));
        void load(person.ref);
      }}
      loadShared={loadShared}
    />
  ) : null;
  return { open, sheet };
}
