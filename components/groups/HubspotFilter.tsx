'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  cleanHubspotFilters,
  hubspotOpNeedsValue,
  hubspotOpsFor,
  type HubspotFilterOp,
  type HubspotOption,
  type HubspotPropDef,
  type HubspotPropFilter,
} from '@/lib/groups-hubspot-shared';
import { useHubspotSchema } from './hubspot-client';

const MAX_ROWS = 3;

/**
 * Filtro de la bandeja por propiedades de la empresa de HubSpot: hasta tres
 * condiciones (se suman), cada una con la propiedad, un operador que depende
 * de su tipo y el valor. Lo escrito se aplica cuando la condición está
 * completa; el texto, un momento después de dejar de escribir.
 */
export default function HubspotFilter({
  value,
  onChange,
  immediate = false,
}: {
  value: HubspotPropFilter[];
  onChange: (next: HubspotPropFilter[]) => void;
  /** Dentro del panel de filtros (un borrador hasta "Aplicar"): lo escrito pasa al momento, sin esperar. */
  immediate?: boolean;
}) {
  const t = useTranslations('groups');
  const { schema } = useHubspotSchema(true);
  const [rows, setRows] = useState<HubspotPropFilter[]>(value);
  const sent = useRef(JSON.stringify(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cambió desde afuera (se abrió una lista, "Limpiar filtros"): se muestra eso.
  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === sent.current) return;
    sent.current = incoming;
    setRows(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(next: HubspotPropFilter[], wait = 0) {
    setRows(next);
    if (timer.current) clearTimeout(timer.current);
    const apply = () => {
      sent.current = JSON.stringify(next);
      onChange(next);
    };
    if (wait > 0 && !immediate) timer.current = setTimeout(apply, wait);
    else apply();
  }

  const props = schema?.props ?? [];
  const defOf = (name: string): HubspotPropDef | undefined => props.find((p) => p.name === name);
  const optionsOf = (def: HubspotPropDef): HubspotOption[] => {
    if (def.kind === 'bool') return [{ value: 'true', label: t('props.yes') }, { value: 'false', label: t('hubspot.screen.no') }];
    if (def.kind === 'owner') return (schema?.owners ?? []).map((o) => ({ value: o.id, label: o.name }));
    return def.options;
  };
  const update = (i: number, patch: Partial<HubspotPropFilter>, wait = 0) => commit(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)), wait);
  const propertyOptions = (
    <>
      {(schema?.groups ?? []).map((g) => (
        <optgroup key={g.name} label={g.label}>
          {props
            .filter((p) => p.group === g.name)
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );

  return (
    <div className="gr-hsf" role="group" aria-label={t('hubspot.pf.title')}>
      {rows.map((r, i) => {
        const def = defOf(r.name);
        const ops = def ? hubspotOpsFor(def.kind) : [r.op];
        const needs = hubspotOpNeedsValue(r.op);
        const opts = def ? optionsOf(def) : [];
        const complete = cleanHubspotFilters([r]).length === 1;
        return (
          <div key={i} className="gr-hsf-row" data-complete={complete || undefined}>
            <select
              className="select"
              value={r.name}
              aria-label={t('hubspot.pf.property')}
              onChange={(e) => {
                const next = defOf(e.target.value);
                if (next) update(i, { name: next.name, op: hubspotOpsFor(next.kind)[0], value: undefined, values: undefined });
              }}
            >
              {!def && <option value={r.name}>{r.name}</option>}
              {propertyOptions}
            </select>
            <select
              className="select"
              value={r.op}
              aria-label={t('hubspot.pf.condition')}
              onChange={(e) => {
                const op = e.target.value as HubspotFilterOp;
                const want = hubspotOpNeedsValue(op);
                update(i, { op, value: want === 'one' ? r.value : undefined, values: want === 'many' ? r.values : undefined });
              }}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {def && (def.kind === 'date' || def.kind === 'datetime') && (op === 'gt' || op === 'lt') ? t(`hubspot.pf.ops.${op}_date`) : t(`hubspot.pf.ops.${op}`)}
                </option>
              ))}
            </select>
            {needs === 'one' &&
              (def && (def.kind === 'date' || def.kind === 'datetime') ? (
                <input className="input" type="date" value={r.value ?? ''} aria-label={t('hubspot.pf.value')} onChange={(e) => update(i, { value: e.target.value })} />
              ) : (
                <input
                  className="input"
                  value={r.value ?? ''}
                  inputMode={def?.kind === 'number' ? 'decimal' : undefined}
                  placeholder={t('hubspot.pf.value')}
                  aria-label={t('hubspot.pf.value')}
                  maxLength={200}
                  onChange={(e) => update(i, { value: e.target.value }, 300)}
                />
              ))}
            {needs === 'many' && (
              <div className="gr-hsf-values">
                <select
                  className="select"
                  value=""
                  aria-label={t('hubspot.pf.addValue')}
                  onChange={(e) => {
                    if (e.target.value) update(i, { values: [...new Set([...(r.values ?? []), e.target.value])] });
                  }}
                >
                  <option value="">{(r.values ?? []).length ? t('hubspot.pf.addAnother') : t('hubspot.pf.addValue')}</option>
                  {opts
                    .filter((o) => !(r.values ?? []).includes(o.value))
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
                {(r.values ?? []).length > 0 && (
                  <ul className="gr-hsf-chosen" aria-label={t('hubspot.pf.chosen')}>
                    {(r.values ?? []).map((v) => {
                      const label = opts.find((o) => o.value === v)?.label ?? v;
                      return (
                        <li key={v}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => update(i, { values: (r.values ?? []).filter((x) => x !== v) })} aria-label={t('hubspot.pf.removeValue', { value: label })}>
                            {label} <span aria-hidden="true">×</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => commit(rows.filter((_, n) => n !== i))} aria-label={t('hubspot.pf.remove', { label: def?.label ?? r.name })}>
              {t('hubspot.pf.removeShort')}
            </button>
          </div>
        );
      })}
      {rows.length < MAX_ROWS && (
        <select
          className="select"
          value=""
          aria-label={t('hubspot.pf.add')}
          disabled={!schema}
          onChange={(e) => {
            const def = defOf(e.target.value);
            if (def) commit([...rows, { name: def.name, op: hubspotOpsFor(def.kind)[0] }]);
          }}
        >
          <option value="">{rows.length ? t('hubspot.pf.addMore') : t('hubspot.pf.add')}</option>
          {propertyOptions}
        </select>
      )}
    </div>
  );
}
