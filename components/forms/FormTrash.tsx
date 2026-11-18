'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { FormsTrashItem } from '@/lib/forms/trash';

/** Papelera de la retención de un form: fecha de cada respuesta, cuándo se borra para siempre y Restaurar. */
export default function FormTrash({ formId, onRestored }: { formId: string; onRestored?: () => void }) {
  const t = useTranslations('forms.builder.settings.trash');
  const format = useFormatter();
  const [items, setItems] = useState<FormsTrashItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/forms/${formId}/trash`).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: FormsTrashItem[] } | null) : null;
    if (data?.items) {
      setItems(data.items);
      setFailed(false);
    } else setFailed(true);
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setBusyId(id);
    setNotice(null);
    const res = await fetch(`/api/forms/${formId}/trash`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: id }) }).catch(() => null);
    setBusyId(null);
    if (res?.ok) {
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
      setNotice({ kind: 'ok', text: t('restored') });
      onRestored?.();
      return;
    }
    setNotice({ kind: 'error', text: res?.status === 409 ? t('conflict') : t('restoreError') });
    void load();
  }

  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium' });
  };
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <section className="fm-trash" data-testid="forms-trash" aria-labelledby="fm-trash-title">
      <h3 id="fm-trash-title" className="label">
        {t('title')}
      </h3>
      <p className="ui-help">{t('help')}</p>
      {items === null && !failed && (
        <p className="ui-help" role="status" data-testid="forms-trash-loading">
          {t('loading')}
        </p>
      )}
      {failed && (
        <p className="fm-error" role="alert">
          {t('error')}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="ui-help" data-testid="forms-trash-empty">
          {t('empty')}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="fm-trash-list">
          {items.map((it) => (
            <li key={it.id} className="fm-trash-item" data-testid="forms-trash-item" data-kind={it.kind}>
              <div className="fm-trash-text">
                <span className="fm-rowtitle">{t(it.kind === 'partial' ? 'partial' : 'response', { date: when(it.date) })}</span>
                <span className="fm-rowmeta">{t('purge', { date: day(it.purgeAt) })}</span>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" data-testid="forms-trash-restore" disabled={busyId !== null} onClick={() => void restore(it.id)}>
                {t('restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className={notice.kind === 'ok' ? 'ui-help' : 'fm-error'} role={notice.kind === 'ok' ? 'status' : 'alert'} data-testid="forms-trash-notice">
          {notice.text}
        </p>
      )}
    </section>
  );
}
