'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalDate from '@/components/ui/LocalDate';
import type { RevisionDto } from '@/lib/bi/revisions';
import type { QuestionDto } from '@/lib/bi/store';
import BiDialog from './BiDialog';
import { biApi, biErrorText, notifyBiChanged } from './client';

/**
 * Historial de versiones de una pregunta: quién cambió qué y cuándo, con
 * "Volver a esta versión" (se guarda como una versión nueva, así que se puede
 * deshacer).
 */
export default function HistoryPanel({
  open,
  onClose,
  questionId,
  canEdit,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  questionId: string;
  canEdit: boolean;
  onRestored: (q: QuestionDto) => void;
}) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const [revisions, setRevisions] = useState<RevisionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRevisions(null);
    setError(null);
    biApi<{ revisions: RevisionDto[] }>(`/api/bi/questions/${questionId}/revisions`)
      .then((d) => alive && setRevisions(d.revisions))
      .catch((err) => {
        if (!alive) return;
        setRevisions([]);
        setError(biErrorText(err, t));
      });
    return () => {
      alive = false;
    };
  }, [open, questionId, t]);

  const restore = async (rev: RevisionDto) => {
    setBusy(rev.id);
    setError(null);
    try {
      const { question } = await biApi<{ question: QuestionDto }>(`/api/bi/questions/${questionId}/revisions`, { body: { revisionId: rev.id } });
      notifyBiChanged();
      onRestored(question);
    } catch (err) {
      setError(biErrorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const what = (rev: RevisionDto): string => {
    if (rev.kind === 'create') return t('history.created');
    if (rev.kind === 'baseline') return t('history.baseline');
    if (rev.kind === 'revert') return t('history.reverted');
    const fields = rev.changes.map((c) => t(`history.field.${c}`));
    return fields.length ? t('history.changed', { fields: new Intl.ListFormat(locale, { type: 'conjunction' }).format(fields) }) : t('history.edited');
  };

  return (
    <BiDialog open={open} title={t('history.title')} onClose={onClose} wide>
      <div className="ui-modal-body">
        {revisions === null ? (
          <p className="bi-muted" role="status">
            {t('common.loading')}
          </p>
        ) : revisions.length === 0 && !error ? (
          <p className="bi-muted">{t('history.empty')}</p>
        ) : (
          <ol className="bi-history" data-testid="bi-history">
            {revisions.map((rev) => (
              <li key={rev.id} className="bi-history-item" data-kind={rev.kind}>
                <div className="bi-history-text">
                  <span className="bi-history-what">{what(rev)}</span>
                  <span className="bi-muted bi-history-meta">
                    {rev.authorName || t('history.someone')} · <LocalDate value={rev.createdAt} locale={locale} />
                  </span>
                </div>
                {rev.current ? (
                  <span className="bi-muted bi-history-current">{t('history.current')}</span>
                ) : (
                  canEdit && (
                    <button type="button" className="btn btn-sm" onClick={() => void restore(rev)} disabled={busy !== null} aria-busy={busy === rev.id} data-testid="bi-history-restore">
                      {t('history.restore')}
                    </button>
                  )
                )}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </BiDialog>
  );
}
