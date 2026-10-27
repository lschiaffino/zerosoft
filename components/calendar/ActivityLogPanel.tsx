'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';

interface Entry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
  actor: { id: string | null; name: string };
}

const GROUPS = ['', 'event_type', 'booking', 'poll', 'workflow', 'routing', 'settings', 'integration', 'api', 'privacy'] as const;

/** Registro de actividad de Cal: quién hizo qué y cuándo, con filtro por tipo. */
export default function ActivityLogPanel({ initial, locale }: { initial: Entry[]; locale: string }) {
  const t = useTranslations('calendar');
  const id = useId();
  const [group, setGroup] = useState('');
  const [entries, setEntries] = useState(initial);
  const [more, setMore] = useState(initial.length >= 100);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function load(nextGroup: string, before?: string) {
    setState('loading');
    const qs = new URLSearchParams();
    if (nextGroup) qs.set('group', nextGroup);
    if (before) qs.set('before', before);
    const res = await fetch(`/api/calendar/activity?${qs.toString()}`).catch(() => null);
    if (!res?.ok) {
      setState('error');
      return;
    }
    const data = (await res.json()) as { entries: Entry[] };
    setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
    setMore(data.entries.length >= 100);
    setState('idle');
  }

  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const label = (action: string) => (t.has(`activity.action.${action.replace('.', '_')}`) ? t(`activity.action.${action.replace('.', '_')}`) : action);

  return (
    <FormSection title={t('activity.title')} description={t('activity.lead')}>
      <div className="ui-field cal-activity-filter">
        <label className="label" htmlFor={`${id}-group`}>
          {t('activity.filter')}
        </label>
        <select
          id={`${id}-group`}
          className="select"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            void load(e.target.value);
          }}
        >
          {GROUPS.map((g) => (
            <option key={g || 'all'} value={g}>
              {t(`activity.group.${g || 'all'}`)}
            </option>
          ))}
        </select>
      </div>
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {t('connections.loadError')}
        </p>
      )}
      {entries.length === 0 ? (
        state === 'loading' ? (
          <p className="cal-muted" role="status" aria-busy="true">
            {t('common.loading')}
          </p>
        ) : (
          <EmptyState title={t('activity.empty')} body={t('activity.emptyLead')} />
        )
      ) : (
        <ol className="cal-activity" aria-busy={state === 'loading' || undefined}>
          {entries.map((e) => (
            <li key={e.id} className="cal-activity-row">
              <span className="cal-activity-what">
                <strong>{e.actor.name || (e.action.includes('.guest_') ? t('activity.guest') : t('activity.system'))}</strong> {label(e.action)}
                {e.summary && <span className="cal-activity-target"> · {e.summary}</span>}
              </span>
              <time className="cal-muted data" dateTime={e.createdAt}>
                {when.format(new Date(e.createdAt))}
              </time>
            </li>
          ))}
        </ol>
      )}
      {more && entries.length > 0 && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void load(group, entries[entries.length - 1]?.createdAt)}
          aria-busy={state === 'loading' || undefined}
        >
          {t('activity.more')}
        </button>
      )}
    </FormSection>
  );
}
