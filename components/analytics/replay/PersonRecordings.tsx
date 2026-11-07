'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { RecordingDto } from '@/lib/analytics/replay';
import { api, fmtDuration, fmtTime } from '../client';

/** Grabaciones de una persona, en su página. */
export default function PersonRecordings({ projectId, personId, replayEnabled, canManage }: { projectId: string; personId: string; replayEnabled: boolean; canManage: boolean }) {
  const t = useTranslations('analyticsReplay.recordings');
  const locale = useLocale();
  const [rows, setRows] = useState<RecordingDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let gone = false;
    const sp = new URLSearchParams({ project: projectId, personId, limit: '10' });
    api<{ recordings: RecordingDto[] }>(`/api/analytics/replay?${sp}`)
      .then((r) => !gone && setRows(r.recordings))
      .catch(() => !gone && setError(true));
    return () => {
      gone = true;
    };
  }, [projectId, personId]);

  return (
    <section className="an-panel" aria-labelledby="an-person-rec-h" data-testid="an-person-recordings">
      <h2 id="an-person-rec-h" className="an-h3">
        {t('title')}
      </h2>
      {error ? (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      ) : rows === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-label={t('loading')} />
      ) : rows.length === 0 ? (
        <p className="an-muted an-small">
          {replayEnabled ? t('personEmpty') : canManage ? t('personOff') : t('personOffMember')}
          {!replayEnabled && canManage && (
            <>
              {' '}
              <Link href="/app/analytics/settings#replay" className="an-link">
                {t('openSettings')}
              </Link>
            </>
          )}
        </p>
      ) : (
        <ol className="an-timeline" role="list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/app/analytics/replay/${r.id}`} className="an-replay-personrow">
                <span className="an-timeline-event">{fmtTime(r.startTs, locale)}</span>
                <span className="an-muted an-small an-nowrap">{fmtDuration(r.durationMs)}</span>
                <span className="an-muted an-small an-ellipsis">{r.firstUrl ?? ''}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
