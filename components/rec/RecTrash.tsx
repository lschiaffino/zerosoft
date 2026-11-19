'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { RecTrashItem } from '@/lib/rec-trash';

/**
 * Papelera de la retención: título del video, de quién es (para un admin), cuándo se borra para siempre y
 * Restaurar. Cada persona ve los suyos; un admin, los de todos. Con la retención apagada y nada adentro, no se
 * muestra.
 */
export default function RecTrash({ retentionOn, names, onRestored, onError }: { retentionOn: boolean; names: Map<string, string>; onRestored: (title: string) => void; onError: (msg: string) => void }) {
  const t = useTranslations('rec.settings.trash');
  const locale = useLocale();
  const [items, setItems] = useState<RecTrashItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/rec/trash').catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: RecTrashItem[] } | null) : null;
    if (data?.items) {
      setItems(data.items);
      setFailed(false);
    } else setFailed(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(it: RecTrashItem) {
    setBusyId(it.id);
    const res = await fetch('/api/rec/trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: it.id }) }).catch(() => null);
    setBusyId(null);
    if (res?.ok) {
      setItems((cur) => (cur ?? []).filter((x) => x.id !== it.id));
      onRestored(it.title);
      return;
    }
    onError(res?.status === 409 ? t('conflict') : t('restoreError'));
    void load();
  }

  if (!retentionOn && !failed && (!items || items.length === 0)) return null;
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
  };

  return (
    <div className="rec-trash" data-testid="rec-trash" role="group" aria-labelledby="rec-trash-title">
      <h3 id="rec-trash-title" className="label">
        {t('title')}
      </h3>
      <p className="ui-help">{t('help')}</p>
      {items === null && !failed && (
        <p className="ui-help" role="status" data-testid="rec-trash-loading">
          {t('loading')}
        </p>
      )}
      {failed && (
        <p className="ui-error" role="alert" data-testid="rec-trash-error">
          {t('error')}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="ui-help" data-testid="rec-trash-empty">
          {t('empty')}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="rec-trash-list">
          {items.map((it) => {
            const owner = it.ownerId ? names.get(it.ownerId) : undefined;
            return (
              <li key={it.id} className="rec-trash-item" data-testid="rec-trash-item" data-entry={it.id}>
                <div className="rec-trash-text">
                  <span className="rec-trash-title">{it.title || t('untitled')}</span>
                  <span className="ui-help">{owner ? t('purgeBy', { date: day(it.purgeAt), name: owner }) : t('purge', { date: day(it.purgeAt) })}</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" data-testid="rec-trash-restore" aria-label={t('restoreNamed', { title: it.title || t('untitled') })} disabled={busyId !== null} onClick={() => void restore(it)}>
                  {t('restore')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
