'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PROPERTY_OPS, type PropertyFilter, type PropertyOp } from '@/lib/analytics/types';
import { api } from './client';

export interface ProjectMeta {
  events: string[];
  eventProperties: string[];
  personProperties: string[];
}

const EMPTY: ProjectMeta = { events: [], eventProperties: [], personProperties: [] };
const cache = new Map<string, ProjectMeta>();

/** Eventos y propiedades vistos en el proyecto (para sugerir en los campos). */
export function useProjectMeta(projectId: string): ProjectMeta {
  const [meta, setMeta] = useState<ProjectMeta>(cache.get(projectId) ?? EMPTY);
  useEffect(() => {
    let alive = true;
    api<ProjectMeta>(`/api/analytics/properties?project=${encodeURIComponent(projectId)}`)
      .then((m) => {
        cache.set(projectId, m);
        if (alive) setMeta(m);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [projectId]);
  return meta;
}

const COMMON_EVENTS = ['$pageview', '$autocapture', '$identify'];

/** Campo de evento con sugerencias ('*' = cualquier evento). */
export function EventInput({
  value,
  onChange,
  meta,
  label,
  allowAny = true,
}: {
  value: string;
  onChange: (v: string) => void;
  meta: ProjectMeta;
  label: string;
  allowAny?: boolean;
}) {
  const id = useId();
  const options = [...new Set([...(allowAny ? ['*'] : []), ...COMMON_EVENTS, ...meta.events])];
  return (
    <>
      <input
        className="input an-event-input"
        aria-label={label}
        list={`${id}-events`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
        spellCheck={false}
      />
      <datalist id={`${id}-events`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

const NEEDS_VALUE: PropertyOp[] = ['eq', 'neq', 'contains', 'not_contains', 'gt', 'lt'];

/** Lista de filtros de propiedades (evento o persona). */
export function FilterList({
  filters,
  onChange,
  meta,
  types = ['event', 'person'],
}: {
  filters: PropertyFilter[];
  onChange: (f: PropertyFilter[]) => void;
  meta: ProjectMeta;
  types?: Array<'event' | 'person'>;
}) {
  const t = useTranslations('analytics.filters');
  const id = useId();
  const set = (i: number, patch: Partial<PropertyFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="an-filters">
      {filters.map((f, i) => (
        <div key={i} className="an-filter" role="group" aria-label={t('filterN', { n: i + 1 })}>
          {types.length > 1 && (
            <select className="select an-filter-type" aria-label={t('type')} value={f.type} onChange={(e) => set(i, { type: e.target.value as 'event' | 'person' })}>
              {types.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`types.${ty}`)}
                </option>
              ))}
            </select>
          )}
          <input
            className="input an-filter-key"
            aria-label={t('property')}
            placeholder={t('property')}
            list={`${id}-${f.type}`}
            value={f.key}
            onChange={(e) => set(i, { key: e.target.value })}
            maxLength={200}
            spellCheck={false}
          />
          <select className="select an-filter-op" aria-label={t('operator')} value={f.op} onChange={(e) => set(i, { op: e.target.value as PropertyOp })}>
            {PROPERTY_OPS.map((op) => (
              <option key={op} value={op}>
                {t(`ops.${op}`)}
              </option>
            ))}
          </select>
          {NEEDS_VALUE.includes(f.op) && (
            <input
              className="input an-filter-value"
              aria-label={t('value')}
              placeholder={t('value')}
              value={f.value === undefined || f.value === null ? '' : String(f.value)}
              onChange={(e) => set(i, { value: e.target.value })}
              maxLength={500}
            />
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label={t('remove')}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...filters, { key: '', op: 'eq', value: '', type: types[0] }])}>
        + {t('add')}
      </button>
      <datalist id={`${id}-event`}>
        {['$pathname', '$current_url', '$host', '$referring_domain', 'utm_source', 'utm_medium', 'utm_campaign', '$browser', '$os', '$device_type', '$geoip_country_code', ...meta.eventProperties]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((k) => (
            <option key={k} value={k} />
          ))}
      </datalist>
      <datalist id={`${id}-person`}>
        {meta.personProperties.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}

/** Filtros completos (sin clave vacía) para mandar al servidor. */
export function cleanFilters(filters: PropertyFilter[]): PropertyFilter[] {
  return filters.filter((f) => f.key.trim()).map((f) => ({ ...f, key: f.key.trim() }));
}
