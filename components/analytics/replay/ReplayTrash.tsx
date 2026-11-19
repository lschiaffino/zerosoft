'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReplayTrashItem } from '@/lib/analytics/trash';
import { notifyChanged } from '../client';

/** Papelera de la retención de replay: cuándo empezó cada grabación, cuándo se borra para siempre y Restaurar (admins). */
export default function ReplayTrash({ projectId }: { projectId: string }) {
  const t = useTranslations('analyticsReplay.trash');
  const format = useFormatter();
  const [items, setItems] = useState<ReplayTrashItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const url = `/api/analytics/projects/${encodeURIComponent(projectId)}/trash`;

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: ReplayTrashItem[] } | null) : null;
    if (data?.items) {
      setItems(data.items);
      setFailed(false);
    } else setFailed(true);
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setBusyId(id);
    setNotice(null);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: id }) }).catch(() => null);
    setBusyId(null);
    if (res?.ok) {
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
      setNotice({ kind: 'ok', text: t('restored') });
      notifyChanged();
      return;
    }
    setNotice({ kind: 'error', text: res?.status === 409 ? t('conflict') : t('restoreError') });
    void load();
  }

  const fmt = (iso: string, withTime: boolean) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
  };

  return (
    <section className="ui-section an-replay-trash" data-testid="an-replay-trash" aria-labelledby="an-replay-trash-h">
      <div className="ui-section-head">
        <h2 id="an-replay-trash-h" className="ui-section-title">
          {t('title')}
        </h2>
        <p className="ui-section-desc">{t('help')}</p>
      </div>
      <div className="ui-section-body">
        {items === null && !failed && (
          <p className="ui-help" role="status" data-testid="an-replay-trash-loading">
            {t('loading')}
          </p>
        )}
        {failed && (
          <p className="ui-error" role="alert" data-testid="an-replay-trash-error">
            {t('error')}
          </p>
        )}
        {items && items.length === 0 && (
          <p className="ui-help" data-testid="an-replay-trash-empty">
            {t('empty')}
          </p>
        )}
        {items && items.length > 0 && (
          <ul className="an-trash-list">
            {items.map((it) => (
              <li key={it.id} className="an-trash-item" data-testid="an-replay-trash-item">
                <div className="an-trash-text">
                  <span className="an-trash-title">{t('recording', { date: fmt(it.startedAt, true) })}</span>
                  <span className="an-trash-meta">{t('purge', { date: fmt(it.purgeAt, false) })}</span>
                </div>
                <button type="button" className="btn btn-sm" data-testid="an-replay-trash-restore" disabled={busyId !== null} onClick={() => void restore(it.id)}>
                  {t('restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {notice && (
          <p className={notice.kind === 'ok' ? 'an-saved' : 'ui-error'} role={notice.kind === 'ok' ? 'status' : 'alert'} data-testid="an-replay-trash-notice">
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
}
