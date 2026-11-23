'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocalText from '@/components/ui/LocalText';
import type { GroupsPerson } from '@/lib/groups';
import type { ChatCrmDeal } from '@/lib/groups-crm-deals';
import { parseDbUtc } from '@/lib/utils';
import { api } from './ui';
import CrmDealList from './wa/CrmDealList';

interface NoteRow {
  id: string;
  body: string;
  sentAt: string;
  authorId?: string | null;
  /** El chat está en varias líneas: la línea donde se escribió la nota. */
  line?: string;
}

/**
 * Pestaña Notas del panel de Lines: las notas internas del chat (las que se escriben con "Nota interna" debajo de
 * la conversación), las últimas primero. Las ve quien ve el chat, igual que en la conversación; un toque lleva a
 * la nota. Si el chat está en varias líneas, junta las de todas las que quien mira ve, cada una con su línea.
 * `version` cambia cuando se escribe o se borra una y la lista se vuelve a leer.
 */
export function ChatNotes({
  chatId,
  people,
  me,
  version,
  onJumpToMessage,
}: {
  chatId: string;
  people: GroupsPerson[];
  me: string;
  version: string;
  onJumpToMessage?: (id: string) => void;
}) {
  const t = useTranslations('groups.wa.details');
  const locale = useLocale();
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void api<{ items: NoteRow[] }>(`/api/groups/chats/${chatId}?shared=notes`).then((r) => {
      if (!live) return;
      if (r.data) setNotes(r.data.items);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [chatId, version, retry]);

  const author = (id: string | null | undefined) => (id && id === me ? t('you') : people.find((p) => p.id === id)?.name || t('teammate'));

  return (
    <section className="gr-detail-section" data-testid="details-notes">
      <h3 className="gr-detail-title">{t('notesTitle')}</h3>
      {failed ? (
        <p className="ui-help" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>
            {t('retry')}
          </button>
        </p>
      ) : notes === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : notes.length === 0 ? (
        <p className="ui-help">{t('empty.notes')}</p>
      ) : (
        <ul className="gr-mini-list gr-starred-list">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" className="gr-starred-item gr-note-item" data-testid="details-note" onClick={() => onJumpToMessage?.(n.id)} disabled={!onJumpToMessage}>
                <span className="ui-help">
                  {author(n.authorId)} · <LocalText>{parseDbUtc(n.sentAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</LocalText>
                  {n.line ? (
                    <span className="gr-note-line" data-testid="details-note-line">
                      {' '}
                      · {n.line}
                    </span>
                  ) : null}
                </span>
                <span className="gr-starred-text" dir="auto">
                  {n.body || t('noteAttachment')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="ui-help">{t('notesHint')}</p>
    </section>
  );
}

/**
 * Los negocios del contacto y la empresa vinculados al chat (pestaña CRM). El servidor ya filtra con la
 * visibilidad del CRM de quien mira (lib/groups-crm-deals.ts). `version` cambia al vincular o desvincular.
 */
export function CrmDeals({ chatId, version }: { chatId: string; version: string }) {
  const t = useTranslations('groups.wa.details');
  const [deals, setDeals] = useState<ChatCrmDeal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void api<{ deals: ChatCrmDeal[] }>(`/api/groups/chats/${chatId}?part=deals`).then((r) => {
      if (!live) return;
      if (r.data) setDeals(r.data.deals);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [chatId, version, retry]);

  return (
    <section className="gr-detail-section" data-testid="details-deals">
      <h3 className="gr-detail-title">{t('deals')}</h3>
      {failed ? (
        <p className="ui-help" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>
            {t('retry')}
          </button>
        </p>
      ) : deals === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : (
        <CrmDealList deals={deals} />
      )}
    </section>
  );
}
