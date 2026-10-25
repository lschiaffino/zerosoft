'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DbAction, DbAutomation, DbProperty, DbTrigger, DbValue, DocsDatabase, DocsMentionableUser } from '@/lib/docs-types';
import { isComputedType, isOptionType, newDbId, orderedOptions, parseNumber } from '@/lib/docs-database';
import { DB_MAX_ACTIONS, DB_MAX_AUTOMATIONS, actionIncomplete } from '@/lib/docs-db-ops';
import DocsGlyph from '../DocsGlyphs';
import { memberName } from './useDbMembers';
import { useWorkspaceDatabases } from './dbSources';

/** Propiedades que una acción "editar propiedad" puede cambiar. */
export function editableProps(db: DocsDatabase): DbProperty[] {
  return db.properties.filter((p) => !isComputedType(p.type) && p.type !== 'files' && p.type !== 'relation');
}

/** Valor de una propiedad en un formulario (acción o disparador). */
export function DbValueInput({
  prop,
  value,
  members,
  onChange,
  allowToday,
  label,
}: {
  prop: DbProperty;
  value: DbValue | undefined;
  members: DocsMentionableUser[];
  onChange: (v: DbValue) => void;
  allowToday?: boolean;
  label: string;
}) {
  const t = useTranslations('docs.database');
  if (prop.type === 'checkbox') {
    return (
      <select className="docs-db-select" aria-label={label} value={value === true ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">{t('checked')}</option>
        <option value="false">{t('unchecked')}</option>
      </select>
    );
  }
  if (isOptionType(prop.type)) {
    const cur = Array.isArray(value) ? value[0] : value;
    return (
      <select
        className="docs-db-select"
        aria-label={label}
        value={typeof cur === 'string' ? cur : ''}
        onChange={(e) => onChange(prop.type === 'multi_select' ? (e.target.value ? [e.target.value] : []) : e.target.value || null)}
      >
        <option value="">{t('pickOption')}</option>
        {orderedOptions(prop).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === 'person') {
    const cur = Array.isArray(value) ? value[0] : '';
    return (
      <select className="docs-db-select" aria-label={label} value={cur ?? ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
        <option value="">{t('pickPerson')}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberName(m)}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === 'date') {
    return (
      <span className="docs-db-inline">
        {allowToday && (
          <select className="docs-db-select" aria-label={label} value={value === '@today' ? '@today' : 'date'} onChange={(e) => onChange(e.target.value === '@today' ? '@today' : null)}>
            <option value="@today">{t('actions.today')}</option>
            <option value="date">{t('actions.pickDay')}</option>
          </select>
        )}
        {value !== '@today' && (
          <input className="docs-db-field mono" type="date" aria-label={label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} />
        )}
      </span>
    );
  }
  if (prop.type === 'number') {
    return (
      <input
        className="docs-db-field mono"
        inputMode="decimal"
        aria-label={label}
        defaultValue={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(parseNumber(e.target.value))}
      />
    );
  }
  return <input className="docs-db-field" aria-label={label} value={typeof value === 'string' ? value : ''} maxLength={500} onChange={(e) => onChange(e.target.value)} />;
}

const ACTION_TYPES = ['set_prop', 'add_row', 'notify', 'webhook', 'open_url'] as const;

function newAction(type: DbAction['type'], db: DocsDatabase): DbAction | null {
  const id = newDbId();
  switch (type) {
    case 'set_prop': {
      const p = editableProps(db).find((x) => x.type !== 'title');
      return p ? { id, type, prop: p.id, value: p.type === 'checkbox' ? true : null } : null;
    }
    case 'add_row':
      return { id, type, target: { page_id: '', block_id: '' }, title: '' };
    case 'notify':
      return { id, type, people: [], message: '' };
    case 'webhook':
      return { id, type, url: '' };
    case 'open_url':
      return { id, type, url: '' };
  }
}

/**
 * Lista de acciones de un botón o automatización: editar una propiedad de la
 * fila, agregar una fila en otra base, notificar a personas, mandar un
 * webhook y (solo botones) abrir un link.
 */
export function DbActionsEditor({
  db,
  actions,
  members,
  onChange,
  forButton,
}: {
  db: DocsDatabase;
  actions: DbAction[];
  members: DocsMentionableUser[];
  onChange: (actions: DbAction[]) => void;
  forButton?: boolean;
}) {
  const t = useTranslations('docs.database');
  const [adding, setAdding] = useState(false);
  const needDbs = actions.some((a) => a.type === 'add_row') || adding;
  const dbs = useWorkspaceDatabases(needDbs);
  const patch = (id: string, p: Partial<DbAction>) => onChange(actions.map((a) => (a.id === id ? ({ ...a, ...p } as DbAction) : a)));
  const types = ACTION_TYPES.filter((x) => forButton || x !== 'open_url');
  const personProps = db.properties.filter((p) => p.type === 'person' || p.type === 'created_by');

  return (
    <div className="docs-db-actions" role="group" aria-label={t('actions.title')}>
      {actions.length === 0 && <p className="docs-db-panel-empty">{t('actions.empty')}</p>}
      {actions.map((a, i) => (
        <div key={a.id} className="docs-db-action" data-testid="docs-db-action">
          <div className="docs-db-action-head">
            <span className="docs-db-filter-join">{i + 1}.</span>
            <span className="docs-db-action-type">{t(`actions.types.${a.type}`)}</span>
            <button type="button" className="docs-db-remove" aria-label={t('actions.remove')} title={t('actions.remove')} onClick={() => onChange(actions.filter((x) => x.id !== a.id))}>
              ×
            </button>
          </div>
          {a.type === 'set_prop' &&
            (() => {
              const prop = db.properties.find((p) => p.id === a.prop);
              const listy = prop && (prop.type === 'multi_select' || prop.type === 'person');
              return (
                <div className="docs-db-action-body">
                  <select
                    className="docs-db-select"
                    aria-label={t('property')}
                    value={a.prop}
                    onChange={(e) => {
                      const p = db.properties.find((x) => x.id === e.target.value);
                      patch(a.id, { prop: e.target.value, value: p?.type === 'checkbox' ? true : null, mode: undefined } as Partial<DbAction>);
                    }}
                  >
                    {editableProps(db).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || t('untitledProperty')}
                      </option>
                    ))}
                  </select>
                  {listy && (
                    <select className="docs-db-select" aria-label={t('actions.mode')} value={a.mode ?? 'set'} onChange={(e) => patch(a.id, { mode: e.target.value as 'set' | 'add' | 'remove' } as Partial<DbAction>)}>
                      <option value="set">{t('actions.modeSet')}</option>
                      <option value="add">{t('actions.modeAdd')}</option>
                      <option value="remove">{t('actions.modeRemove')}</option>
                    </select>
                  )}
                  {prop && <DbValueInput prop={prop} value={a.value} members={members} allowToday label={t('actions.value')} onChange={(value) => patch(a.id, { value } as Partial<DbAction>)} />}
                </div>
              );
            })()}
          {a.type === 'add_row' && (
            <div className="docs-db-action-body">
              <select
                className="docs-db-select"
                aria-label={t('actions.targetDatabase')}
                value={a.target.page_id ? `${a.target.page_id}:${a.target.block_id}` : ''}
                onChange={(e) => {
                  const [page_id, block_id] = e.target.value.split(':');
                  patch(a.id, { target: { page_id: page_id ?? '', block_id: block_id ?? '' } } as Partial<DbAction>);
                }}
              >
                <option value="">{dbs.status === 'loading' ? t('relation.loading') : t('actions.pickDatabase')}</option>
                {dbs.rows.map((d) => (
                  <option key={`${d.page_id}:${d.block_id}`} value={`${d.page_id}:${d.block_id}`}>
                    {d.title || t('untitledDatabase')} · {d.page_title || t('untitledPage')}
                  </option>
                ))}
              </select>
              <input
                className="docs-db-field"
                aria-label={t('actions.rowTitle')}
                placeholder={t('actions.rowTitlePlaceholder')}
                value={a.title ?? ''}
                maxLength={500}
                onChange={(e) => patch(a.id, { title: e.target.value } as Partial<DbAction>)}
              />
            </div>
          )}
          {a.type === 'notify' && (
            <div className="docs-db-action-body">
              <div className="docs-db-checklist" role="group" aria-label={t('actions.people')}>
                {members.map((m) => (
                  <label key={m.id} className="docs-db-propitem">
                    <input
                      type="checkbox"
                      checked={(a.people ?? []).includes(m.id)}
                      onChange={(e) =>
                        patch(a.id, { people: e.target.checked ? [...(a.people ?? []), m.id].slice(0, 20) : (a.people ?? []).filter((x) => x !== m.id) } as Partial<DbAction>)
                      }
                    />
                    <span>{memberName(m)}</span>
                  </label>
                ))}
              </div>
              {personProps.length > 0 && (
                <select className="docs-db-select" aria-label={t('actions.personProp')} value={a.person_prop ?? ''} onChange={(e) => patch(a.id, { person_prop: e.target.value || undefined } as Partial<DbAction>)}>
                  <option value="">{t('actions.noPersonProp')}</option>
                  {personProps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t('actions.peopleIn', { name: p.name })}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="docs-db-field"
                aria-label={t('actions.message')}
                placeholder={t('actions.messagePlaceholder')}
                value={a.message ?? ''}
                maxLength={1000}
                onChange={(e) => patch(a.id, { message: e.target.value } as Partial<DbAction>)}
              />
            </div>
          )}
          {actionIncomplete(a) && (
            <p className="docs-db-hint docs-db-action-incomplete" data-testid="docs-db-action-incomplete">
              {t('actions.incomplete')}
            </p>
          )}
          {(a.type === 'webhook' || a.type === 'open_url') && (
            <div className="docs-db-action-body">
              <input
                className="docs-db-field mono"
                type="url"
                aria-label={a.type === 'webhook' ? t('actions.webhookUrl') : t('actions.url')}
                placeholder="https://"
                value={a.url}
                maxLength={2048}
                onChange={(e) => patch(a.id, { url: e.target.value.trim() } as Partial<DbAction>)}
              />
              {a.type === 'webhook' && <p className="docs-db-hint">{t('actions.webhookHint')}</p>}
            </div>
          )}
        </div>
      ))}
      {actions.length < DB_MAX_ACTIONS &&
        (adding ? (
          <div className="docs-db-menu" role="menu" aria-label={t('actions.add')}>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="docs-db-menu-item"
                onClick={() => {
                  const a = newAction(type, db);
                  if (a) onChange([...actions, a]);
                  setAdding(false);
                }}
              >
                {t(`actions.types.${type}`)}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="docs-db-link-btn" onClick={() => setAdding(true)}>
            <DocsGlyph name="plus" size={12} />
            {t('actions.add')}
          </button>
        ))}
    </div>
  );
}

/** Motivos de una corrida fallida con texto propio (el resto se muestra tal cual: http_500…). */
const RUN_DETAILS = new Set(['incomplete', 'no_recipients', 'not_found', 'forbidden', 'conflict', 'invalid_input']);

interface Run {
  id: string;
  automation_id: string;
  row_id: string;
  action_type: string;
  status: 'ok' | 'error';
  detail: string;
  created_at: string;
}

/**
 * Automatizaciones de la base (como las de Notion): cuando se agrega una
 * fila o cambia una propiedad (opcional: "a" un valor), solo en las filas de
 * una vista si se elige, hacer acciones. Con el registro de las últimas
 * corridas de las acciones de afuera.
 */
export function DbAutomationsPanel({
  db,
  members,
  commit,
  runsUrl,
}: {
  db: DocsDatabase;
  members: DocsMentionableUser[];
  commit: (next: DocsDatabase) => void;
  runsUrl: string | null;
}) {
  const t = useTranslations('docs.database');
  const locale = useLocale();
  const list = db.automations ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsError, setRunsError] = useState(false);
  const set = (next: DbAutomation[]) => commit({ ...db, automations: next });
  const patch = (id: string, p: Partial<DbAutomation>) => set(list.map((a) => (a.id === id ? { ...a, ...p } : a)));

  useEffect(() => {
    if (!runsUrl) return;
    let alive = true;
    fetch(runsUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { rows?: Run[] }) => alive && setRuns(d.rows ?? []))
      .catch(() => alive && setRunsError(true));
    return () => {
      alive = false;
    };
  }, [runsUrl]);

  const add = () => {
    const a: DbAutomation = { id: newDbId(), name: '', enabled: true, trigger: { type: 'row_added' }, view: null, actions: [] };
    set([...list, a]);
    setOpenId(a.id);
  };

  const triggerProps = db.properties.filter((p) => p.type !== 'button' && p.type !== 'formula' && p.type !== 'rollup' && p.type !== 'created_time' && p.type !== 'last_edited_time' && p.type !== 'created_by' && p.type !== 'last_edited_by' && p.type !== 'unique_id');
  const name = (a: DbAutomation) => a.name || t('automations.untitled');

  return (
    <div className="docs-db-panel docs-db-automations" aria-label={t('automations.title')} data-testid="docs-db-automations">
      <p className="docs-db-menu-label">{t('automations.title')}</p>
      {list.length === 0 && <p className="docs-db-panel-empty">{t('automations.empty')}</p>}
      {list.map((a) => {
        const open = openId === a.id;
        const trigProp = a.trigger.type === 'prop_changed' ? db.properties.find((p) => p.id === (a.trigger as { prop: string }).prop) : undefined;
        return (
          <div key={a.id} className={`docs-db-auto${open ? ' open' : ''}`} data-testid="docs-db-automation">
            <div className="docs-db-auto-head">
              <label className="docs-db-switch">
                <input type="checkbox" checked={a.enabled} aria-label={t('automations.enabled', { name: name(a) })} onChange={(e) => patch(a.id, { enabled: e.target.checked })} />
              </label>
              <button type="button" className="docs-db-auto-name" aria-expanded={open} onClick={() => setOpenId(open ? null : a.id)}>
                {name(a)}
              </button>
              <button type="button" className="docs-db-remove" aria-label={t('automations.delete', { name: name(a) })} title={t('automations.delete', { name: name(a) })} onClick={() => set(list.filter((x) => x.id !== a.id))}>
                ×
              </button>
            </div>
            {open && (
              <div className="docs-db-auto-body">
                <input className="docs-db-field" aria-label={t('automations.name')} placeholder={t('automations.namePlaceholder')} value={a.name} maxLength={200} onChange={(e) => patch(a.id, { name: e.target.value })} />
                <p className="docs-db-menu-label">{t('automations.when')}</p>
                <div className="docs-db-action-body">
                  <select
                    className="docs-db-select"
                    aria-label={t('automations.trigger')}
                    value={a.trigger.type === 'row_added' ? 'row_added' : `prop:${(a.trigger as { prop: string }).prop}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      const trigger: DbTrigger = v === 'row_added' ? { type: 'row_added' } : { type: 'prop_changed', prop: v.slice(5) };
                      patch(a.id, { trigger });
                    }}
                  >
                    <option value="row_added">{t('automations.rowAdded')}</option>
                    {triggerProps.map((p) => (
                      <option key={p.id} value={`prop:${p.id}`}>
                        {t('automations.propChanged', { name: p.name || t('untitledProperty') })}
                      </option>
                    ))}
                  </select>
                  {trigProp && trigProp.type !== 'relation' && trigProp.type !== 'files' && (
                    <>
                      <span className="docs-db-filter-join">{t('automations.to')}</span>
                      <DbValueInput
                        prop={trigProp}
                        value={(a.trigger as { to?: DbValue }).to}
                        members={members}
                        label={t('automations.toValue')}
                        onChange={(to) => patch(a.id, { trigger: { type: 'prop_changed', prop: trigProp.id, ...(to === null || to === '' || (Array.isArray(to) && !to.length) ? {} : { to }) } })}
                      />
                    </>
                  )}
                </div>
                <label className="docs-db-row-field">
                  <span>{t('automations.scope')}</span>
                  <select className="docs-db-select" value={a.view ?? ''} onChange={(e) => patch(a.id, { view: e.target.value || null })}>
                    <option value="">{t('automations.allRows')}</option>
                    {db.views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {t('automations.rowsInView', { name: v.name || t(`viewTypes.${v.type}`) })}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="docs-db-menu-label">{t('automations.do')}</p>
                <DbActionsEditor db={db} actions={a.actions} members={members} onChange={(actions) => patch(a.id, { actions })} />
              </div>
            )}
          </div>
        );
      })}
      <div className="docs-db-panel-foot">
        <button type="button" className="docs-db-link-btn" disabled={list.length >= DB_MAX_AUTOMATIONS} onClick={add}>
          <DocsGlyph name="plus" size={12} />
          {t('automations.add')}
        </button>
      </div>
      {runsUrl && (
        <details className="docs-db-runs">
          <summary>{t('automations.runs')}</summary>
          {runsError && <p className="docs-db-error">{t('automations.runsError')}</p>}
          {!runsError && runs === null && <p className="docs-db-panel-empty">{t('relation.loading')}</p>}
          {runs && runs.length === 0 && <p className="docs-db-panel-empty">{t('automations.noRuns')}</p>}
          {runs && runs.length > 0 && (
            <ul className="docs-db-runs-list">
              {runs.slice(0, 20).map((r) => {
                const auto = list.find((x) => x.id === r.automation_id);
                const who = auto ? name(auto) : r.automation_id.startsWith('button:') ? t('automations.button') : t('automations.deleted');
                return (
                  <li key={r.id} className={r.status === 'error' ? 'is-error' : ''}>
                    <span className="docs-db-muted mono">{new Date(r.created_at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span>
                      {who} · {t(`actions.types.${r.action_type}`)}
                    </span>
                    <span className="docs-db-muted">
                      {r.status === 'ok'
                        ? t('automations.ok')
                        : t('automations.failed', { detail: RUN_DETAILS.has(r.detail) ? t(`automations.details.${r.detail}`) : r.detail })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
