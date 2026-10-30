'use client';

import { Fragment, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { personLabel, type LiveEvent, type PersonRow } from '@/lib/analytics/types';
import { api, fmtTime } from './client';

/** Una persona: propiedades, distinct_ids, línea de tiempo de eventos y borrar (admins). */
export default function PersonDetail({ person, events: initial, canDelete }: { person: PersonRow; events: LiveEvent[]; canDelete: boolean }) {
  const t = useTranslations('analytics.persons');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length >= 100);
  const [open, setOpen] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = personLabel(person);
  const props = Object.entries(person.properties).sort(([a], [b]) => a.localeCompare(b));

  const more = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    const r = await api<{ events: LiveEvent[] }>(`/api/analytics/persons/${person.id}?before=${last.ts}`);
    setEvents((e) => [...e, ...r.events]);
    setHasMore(r.events.length >= 100);
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/analytics/persons', label: t('title') }}
        title={name}
        description={person.isIdentified ? t('identified') : t('anonymous')}
        actions={
          canDelete ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
              {t('delete')}
            </button>
          ) : undefined
        }
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="an-person-grid">
        <section className="an-panel" aria-labelledby="an-props-h">
          <h2 id="an-props-h" className="an-h3">
            {t('properties')}
          </h2>
          {props.length === 0 ? (
            <p className="an-muted an-small">{t('noProperties')}</p>
          ) : (
            <dl className="an-props">
              {props.map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          <h3 className="an-h4">{t('distinctIds')}</h3>
          <ul className="an-ids" role="list">
            {person.distinctIds.map((d) => (
              <li key={d} className="an-mono">
                {d}
              </li>
            ))}
          </ul>
          <p className="an-muted an-small">
            {t('firstSeen', { date: fmtTime(person.createdAt, locale) })} · {t('lastSeenAt', { date: fmtTime(person.lastSeen, locale) })}
          </p>
        </section>
        <section className="an-panel" aria-labelledby="an-timeline-h">
          <h2 id="an-timeline-h" className="an-h3">
            {t('timeline')}
          </h2>
          {events.length === 0 ? (
            <p className="an-muted an-small">{t('noEvents')}</p>
          ) : (
            <ol className="an-timeline" role="list">
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="an-row-button" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <span className="an-timeline-event">{e.event}</span>
                    <span className="an-muted an-ellipsis">{e.pathname ?? ''}</span>
                    <span className="an-muted an-nowrap an-small">{fmtTime(e.ts, locale)}</span>
                  </button>
                  {open === e.id && (
                    <dl className="an-props">
                      {Object.entries(e.properties).map(([k, v]) => (
                        <Fragment key={k}>
                          <dt>{k}</dt>
                          <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
          )}
          {hasMore && (
            <button type="button" className="btn btn-sm" onClick={() => void more()}>
              {t('olderEvents')}
            </button>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/persons/${person.id}`, { method: 'DELETE' });
            router.replace('/app/analytics/persons');
            router.refresh();
          } catch {
            setError(tc('error'));
            setBusy(false);
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
