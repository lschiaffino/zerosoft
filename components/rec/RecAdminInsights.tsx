'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocalText from '@/components/ui/LocalText';
import type { RecActivityItem, RecWorkspaceInsights } from '@/lib/rec-admin';
import { parseDbUtc } from '@/lib/utils';

/** Uso del workspace y registro de actividad, para admins (dentro de los ajustes de Rec). */
export default function RecAdminInsights() {
  const t = useTranslations('rec.admin');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const [data, setData] = useState<{ insights: RecWorkspaceInsights; activity: RecActivityItem[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/rec/settings/insights')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d: { insights: RecWorkspaceInsights; activity: RecActivityItem[] }) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="ui-error" role="alert">
        {tc('errors.generic')}
      </p>
    );
  }
  if (!data) return <div className="ui-skeleton-text" aria-busy="true" />;
  const { insights: s, activity } = data;
  const when = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d));
  const actionText = (a: RecActivityItem) => (t.has(`actions.${a.action}`) ? t(`actions.${a.action}`, { days: a.days ?? 0, count: a.count ?? 0 }) : a.action);

  return (
    <>
      <section className="rec-edit-block" data-testid="rec-admin-insights">
        <h2 className="rec-h">{t('insights')}</h2>
        <p className="ui-help">{t('insightsHelp', { days: s.days })}</p>
        <dl className="rec-stats">
          <div>
            <dt>{t('videos')}</dt>
            <dd className="data">{s.videos}</dd>
          </div>
          <div>
            <dt>{t('creators')}</dt>
            <dd className="data">{s.creators}</dd>
          </div>
          <div>
            <dt>{t('views')}</dt>
            <dd className="data">{s.views}</dd>
          </div>
          <div>
            <dt>{t('viewers')}</dt>
            <dd className="data">{s.viewers}</dd>
          </div>
          <div>
            <dt>{t('comments')}</dt>
            <dd className="data">{s.comments}</dd>
          </div>
        </dl>
        {s.people.length === 0 ? (
          <p className="ui-help">{t('noPeople')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <caption className="sr-only">{t('byPerson')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('person')}</th>
                  <th scope="col" className="num">
                    {t('videos')}
                  </th>
                  <th scope="col" className="num">
                    {t('views')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.people.map((p) => (
                  <tr key={p.userId} data-testid="rec-admin-person">
                    <td>{p.name}</td>
                    <td className="num data">{p.videos}</td>
                    <td className="num data">{p.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="rec-h rec-h-sub">{t('topVideos')}</h3>
        {s.topVideos.length === 0 ? (
          <p className="ui-help">{t('noTop')}</p>
        ) : (
          <ol className="rec-admin-top">
            {s.topVideos.map((v) => (
              <li key={v.id}>
                <Link href={`/app/rec/${v.id}`}>{v.title}</Link>
                <span className="muted data">{t('viewsN', { n: v.views })}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="ui-help">{t('privateNote')}</p>
      </section>
      <section className="rec-edit-block" data-testid="rec-admin-activity">
        <h2 className="rec-h">{t('activity')}</h2>
        <p className="ui-help">{t('activityHelp')}</p>
        {activity.length === 0 ? (
          <p className="ui-help">{t('noActivity')}</p>
        ) : (
          <ul className="rec-admin-log">
            {activity.map((a) => (
              <li key={a.id} data-testid="rec-admin-log-row">
                <span>
                  <strong>{a.actorName || t('someone')}</strong> {actionText(a)}
                </span>
                <span className="muted data">
                  <LocalText>{when(a.createdAt)}</LocalText>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
