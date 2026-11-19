'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HiringTrashItem } from '@/lib/hiring/trash';
import { api, useDate } from './ui';

/** Papelera de la retención de candidatos (solo admins): nombre, cuándo se borra para siempre y Restaurar. */
export default function HiringTrash({ onNotice }: { onNotice: (msg: string, tone?: 'ok' | 'bad') => void }) {
  const t = useTranslations('hiring.settings.trash');
  const date = useDate();
  const [items, setItems] = useState<HiringTrashItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: HiringTrashItem[] }>('/api/hiring/trash');
    if (res.ok && Array.isArray(res.data.items)) {
      setItems(res.data.items);
      setFailed(false);
    } else setFailed(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(it: HiringTrashItem) {
    setBusyId(it.id);
    const res = await api('/api/hiring/trash', { method: 'POST', json: { entryId: it.id } });
    setBusyId(null);
    if (res.ok) {
      setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
      onNotice(t('restored', { name: it.name }));
      return;
    }
    onNotice(res.status === 409 ? t('conflict') : t('restoreError'), 'bad');
    void load();
  }

  return (
    <section className="hr-trash" data-testid="hiring-trash" aria-labelledby="hr-trash-title">
      <h3 id="hr-trash-title" className="label">
        {t('title')}
      </h3>
      <p className="ui-help">{t('help')}</p>
      {items === null && !failed && (
        <p className="ui-help" role="status" data-testid="hiring-trash-loading">
          {t('loading')}
        </p>
      )}
      {failed && (
        <p className="ui-error" role="alert" data-testid="hiring-trash-error">
          {t('error')}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="ui-help" data-testid="hiring-trash-empty">
          {t('empty')}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="hr-trash-list">
          {items.map((it) => (
            <li key={it.id} className="hr-trash-item" data-testid="hiring-trash-item" data-entry={it.id}>
              <div className="hr-trash-text">
                <span className="hr-trash-name">{it.name}</span>
                <span className="ui-help">{t('purge', { date: date(it.purgeAt, false) })}</span>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" data-testid="hiring-trash-restore" aria-label={t('restoreNamed', { name: it.name })} disabled={busyId !== null} onClick={() => void restore(it)}>
                {t('restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
