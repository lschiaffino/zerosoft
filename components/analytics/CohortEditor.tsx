'use client';

import { useEffect, useState } from 'react';
import PublicLinksNotice from './PublicLinksNotice';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { CohortDto, CohortGroup, PropertyFilter } from '@/lib/analytics/types';
import { apiErrorText, api, fmtNumber, notifyChanged } from './client';
import { EventInput, FilterList, cleanFilters, useProjectMeta, type ProjectMeta } from './Filters';

/**
 * Cohorte (como las dinámicas de PostHog): propiedades de la persona y/o
 * "hizo el evento al menos N veces en los últimos D días". Muestra cuántas
 * personas entran hoy y lleva a la lista.
 */
type Behavior = CohortGroup['behaviors'][number];

/** Un grupo de reglas: propiedades de la persona y lo que hizo o no hizo. Dentro del grupo, todo con AND. */
function GroupEditor({ group, onChange, meta, index, onRemove }: { group: CohortGroup; onChange: (g: CohortGroup) => void; meta: ProjectMeta; index: number; onRemove?: () => void }) {
  const t = useTranslations('analytics.cohorts');
  const tc = useTranslations('analytics.common');
  const setB = (i: number, patch: Partial<Behavior>) => onChange({ ...group, behaviors: group.behaviors.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <fieldset className="an-series" data-testid="an-cohort-group">
      <legend className="an-series-legend">{t('groupN', { n: index + 1 })}</legend>
      <span className="label">{t('propertiesTitle')}</span>
      <FilterList filters={group.properties as PropertyFilter[]} onChange={(f) => onChange({ ...group, properties: f as CohortGroup['properties'] })} meta={meta} types={['person']} />
      <span className="label">{t('behaviorsTitle')}</span>
      {group.behaviors.map((b, i) => (
        <div key={i} className="an-row an-wrap">
          <select className="select" aria-label={t('didOrNot')} value={b.negate ? 'no' : 'yes'} onChange={(e) => setB(i, { negate: e.target.value === 'no' })}>
            <option value="yes">{t('did')}</option>
            <option value="no">{t('didNot')}</option>
          </select>
          <EventInput value={b.event} onChange={(event) => setB(i, { event })} meta={{ ...meta, actions: [] }} label={t('event')} allowAny={false} />
          <label className="ui-field an-inline-field">
            <span className="label">{t('minCount')}</span>
            <input className="input an-num-input" type="number" min={1} value={b.minCount} onChange={(e) => setB(i, { minCount: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="ui-field an-inline-field">
            <span className="label">{t('days')}</span>
            <input className="input an-num-input" type="number" min={1} max={365} value={b.days} onChange={(e) => setB(i, { days: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...group, behaviors: group.behaviors.filter((_, j) => j !== i) })}>
            {tc('remove')}
          </button>
        </div>
      ))}
      <div className="an-row an-wrap">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={group.behaviors.length >= 5}
          title={group.behaviors.length >= 5 ? t('behaviorsMax') : undefined}
          onClick={() => onChange({ ...group, behaviors: [...group.behaviors, { event: '$pageview', days: 30, minCount: 1, negate: false }] })}
        >
          + {t('addBehavior')}
        </button>
        {onRemove && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            {t('removeGroup')}
          </button>
        )}
      </div>
    </fieldset>
  );
}

/** Lo que estaba guardado con el formato anterior (propiedades y una regla) es un solo grupo. */
function initialGroups(c: CohortDto): CohortGroup[] {
  if (c.definition.groups?.length) return c.definition.groups;
  return [{ properties: c.definition.properties, behaviors: c.definition.behavior ? [{ ...c.definition.behavior, negate: false }] : [] }];
}

/**
 * Cohorte (como las de PostHog). Dinámica: grupos de reglas unidos con O.
 * Estática: una lista subida en CSV o guardada desde una lista de personas.
 */
export default function CohortEditor({ projectId, cohort, publicLinks = [] }: { projectId: string; cohort: CohortDto; publicLinks?: Array<{ shareId: string; name: string }> }) {
  const t = useTranslations('analytics.cohorts');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const isStatic = cohort.definition.type === 'static';
  const [name, setName] = useState(cohort.name);
  const [groups, setGroups] = useState<CohortGroup[]>(() => initialGroups(cohort));
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paste, setPaste] = useState('');

  const refreshCount = () =>
    api<{ count: number }>(`/api/analytics/cohorts/${cohort.id}`)
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));

  useEffect(() => {
    setName(cohort.name);
    setGroups(initialGroups(cohort));
    void refreshCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohort]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const definition = isStatic
        ? { type: 'static', properties: [], behavior: null, groups: [] }
        : {
            type: 'dynamic',
            properties: [],
            behavior: null,
            groups: groups.map((g) => ({ properties: cleanFilters(g.properties as PropertyFilter[]).map((p) => ({ ...p, type: 'person' })), behaviors: g.behaviors })),
          };
      await api(`/api/analytics/cohorts/${cohort.id}`, { method: 'PATCH', body: { name, definition } });
      await refreshCount();
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ added: number; notFound: number }>(`/api/analytics/cohorts/${cohort.id}/members`, { body: { text } });
      await refreshCount();
      setPaste('');
      setMsg({ ok: true, text: t('uploaded', { added: r.added, notFound: r.notFound }) });
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="an-panel an-cohort" aria-label={t('editTitle', { name: cohort.name })} data-testid="an-cohort-editor">
      <PublicLinksNotice links={publicLinks} />
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
        {isStatic ? (
          <fieldset className="an-series">
            <legend className="an-series-legend">{t('staticTitle')}</legend>
            <p className="an-note">{t('staticHelp')}</p>
            <input
              className="input"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              aria-label={t('uploadCsv')}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1_500_000) {
                  setMsg({ ok: false, text: t('fileTooBig') });
                  return;
                }
                void f.text().then(upload);
                e.target.value = '';
              }}
            />
            <textarea className="textarea an-mono" rows={3} aria-label={t('pasteList')} placeholder={t('pasteList')} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <button type="button" className="btn btn-sm an-self-start" disabled={busy || !paste.trim()} onClick={() => void upload(paste)}>
              {t('addList')}
            </button>
          </fieldset>
        ) : (
          <>
            <p className="an-note">{t('groupsHelp')}</p>
            {groups.map((g, i) => (
              <GroupEditor key={i} index={i} group={g} meta={meta} onChange={(next) => setGroups(groups.map((x, j) => (j === i ? next : x)))} onRemove={groups.length > 1 ? () => setGroups(groups.filter((_, j) => j !== i)) : undefined} />
            ))}
            <button
              type="button"
              className="btn btn-sm an-self-start"
              disabled={groups.length >= 10}
              title={groups.length >= 10 ? t('groupsMax') : undefined}
              onClick={() => setGroups([...groups, { properties: [], behaviors: [] }])}
            >
              + {t('addGroup')}
            </button>
          </>
        )}
        <div className="an-row an-wrap">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {tc('save')}
          </button>
          {count !== null && (
            <span className="an-muted" role="status">
              {t('count', { count: fmtNumber(count, locale) })}
            </span>
          )}
          <Link href={`/app/pulse/persons?cohort=${cohort.id}`} className="an-link">
            {t('seePersons')}
          </Link>
          <Link href="/app/pulse/cohorts" className="an-link">
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
