'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ThreadDto } from '@/lib/inbox/types';
import Avatar from '@/components/groups/wa/Avatar';
import { api } from './api';
import { Modal } from './InboxDialogs';
import { chatName } from './wa/util';

/** Días que un chat queda en "Sacados de Inbox" (lib/inbox/removed.ts, REMOVED_RETENTION_DAYS). */
const RETENTION_DAYS = 30;

function day(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "Sacados de Inbox": los chats que la persona sacó, con cuándo y hasta cuándo
 * quedan. Recuperar los devuelve a donde estaban; borrar definitivamente pide
 * confirmación. Los chats no se abren desde acá (primero se recuperan).
 */
export default function RemovedList({
  threads,
  onChanged,
  onToast,
  errText,
}: {
  threads: ThreadDto[];
  onChanged: (gone: string[]) => void;
  onToast: (text: string, opts?: { bad?: boolean }) => void;
  errText: (code?: string) => string;
}) {
  const t = useTranslations('inbox.removed');
  const w = useTranslations('inboxWa');
  const locale = useLocale();
  const [busy, setBusy] = useState('');
  const [purging, setPurging] = useState<ThreadDto | null>(null);

  const run = async (th: ThreadDto, action: 'restore' | 'purge') => {
    setBusy(th.id);
    const r = await api<{ changed: string[] }>('/api/inbox/threads', {
      method: 'POST',
      json: { ids: [th.id], action },
    });
    setBusy('');
    if (!r.ok) {
      onToast(errText(r.data.error), { bad: true });
      return;
    }
    onToast(t(action === 'restore' ? 'restored' : 'purged'));
    onChanged([th.id]);
  };

  return (
    <div className="ib-removed" data-testid="inbox-removed">
      <p className="ib-removed-note">{t('note', { days: RETENTION_DAYS })}</p>
      {threads.length > 0 && (
        <ul className="ib-removed-list" aria-label={t('list')}>
          {threads.map((th) => {
            const name = chatName(th, w('group'));
            return (
              <li key={th.id} className="ib-removed-item" data-testid="inbox-removed-item" data-thread-id={th.id}>
                <Avatar name={name} kind={th.kind === 'group' ? 'group' : 'dm'} seed={th.id} />
                <div className="ib-removed-main">
                  <span className="ib-removed-name" dir="auto">
                    {name}
                  </span>
                  <span className="ib-removed-meta">
                    {t('removedAt', { date: day(th.removedAt, locale) })} · {t('purgeAt', { date: day(th.purgeAt, locale) })}
                  </span>
                  <span className="ib-removed-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy === th.id}
                      onClick={() => void run(th, 'restore')}
                      data-testid="inbox-removed-restore"
                    >
                      {t('restore')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm ib-danger" disabled={busy === th.id} onClick={() => setPurging(th)} data-testid="inbox-removed-purge">
                      {t('purge')}
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!purging} title={purging ? t('purgeTitle', { name: chatName(purging, w('group')) }) : ''} onClose={() => setPurging(null)}>
        <div className="ui-modal-body">
          <div className="ib-confirm">
            <p>{t('purgeBody')}</p>
            <div className="ib-row">
              <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setPurging(null)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                data-testid="inbox-removed-purge-yes"
                onClick={() => {
                  const th = purging;
                  setPurging(null);
                  if (th) void run(th, 'purge');
                }}
              >
                {t('purge')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
