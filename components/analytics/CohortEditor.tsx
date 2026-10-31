'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { CohortDto, PropertyFilter } from '@/lib/analytics/types';
import { ApiError, apiErrorText, api, fmtNumber, notifyChanged } from './client';
import { EventInput, FilterList, cleanFilters, useProjectMeta } from './Filters';

/**
 * Cohorte (como las dinámicas de PostHog): propiedades de la persona y/o
 * "hizo el evento al menos N veces en los últimos D días". Muestra cuántas
 * personas entran hoy y lleva a la lista.
 */
export default function CohortEditor({ projectId, cohort }: { projectId: string; cohort: CohortDto }) {
  const t = useTranslations('analytics.cohorts');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [name, setName] = useState(cohort.name);
  const [props, setProps] = useState<PropertyFilter[]>(cohort.definition.properties);
  const [behavior, setBehavior] = useState(cohort.definition.behavior);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setName(cohort.name);
    setProps(cohort.definition.properties);
    setBehavior(cohort.definition.behavior);
    api<{ count: number }>(`/api/analytics/cohorts/${cohort.id}`)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, [cohort]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/cohorts/${cohort.id}`, {
        method: 'PATCH',
        body: { name, definition: { properties: cleanFilters(props).map((p) => ({ ...p, type: 'person' })), behavior } },
      });
      const r = await api<{ count: number }>(`/api/analytics/cohorts/${cohort.id}`);
      setCount(r.count);
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="an-panel an-cohort" aria-label={t('editTitle', { name: cohort.name })} data-testid="an-cohort-editor">
      <form
        className="an-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>
        <fieldset className="an-series">
          <legend className="an-series-legend">{t('propertiesTitle')}</legend>
          <FilterList filters={props} onChange={setProps} meta={meta} types={['person']} />
        </fieldset>
        <fieldset className="an-series">
          <legend className="an-series-legend">
            <label className="ui-check">
              <input
                type="checkbox"
                checked={behavior !== null}
                onChange={(e) => setBehavior(e.target.checked ? { event: '$pageview', days: 30, minCount: 1 } : null)}
              />{' '}
              {t('behaviorTitle')}
            </label>
          </legend>
          {behavior && (
            <div className="an-row an-wrap">
              <EventInput value={behavior.event} onChange={(event) => setBehavior({ ...behavior, event })} meta={meta} label={t('event')} allowAny={false} />
              <label className="ui-field an-inline-field">
                <span className="label">{t('minCount')}</span>
                <input
                  className="input an-num-input"
                  type="number"
                  min={1}
                  value={behavior.minCount}
                  onChange={(e) => setBehavior({ ...behavior, minCount: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <label className="ui-field an-inline-field">
                <span className="label">{t('days')}</span>
                <input
                  className="input an-num-input"
                  type="number"
                  min={1}
                  max={365}
                  value={behavior.days}
                  onChange={(e) => setBehavior({ ...behavior, days: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </label>
            </div>
          )}
        </fieldset>
        <div className="an-row an-wrap">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {tc('save')}
          </button>
          {count !== null && (
            <span className="an-muted" role="status">
              {t('count', { count: fmtNumber(count, locale) })}
            </span>
          )}
          <Link href={`/app/analytics/persons?cohort=${cohort.id}`} className="an-link">
            {t('seePersons')}
          </Link>
          <Link href="/app/analytics/cohorts" className="an-link">
            {tc('close')}
          </Link>
        </div>
        {msg && (
          <p className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
      </form>
    </section>
  );
}
