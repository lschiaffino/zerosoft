'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { nextCronRuns } from '@/lib/cron';
import {
  FLOW_EVENT_TYPES,
  NODE_DEFS,
  ON_ERROR_MODES,
  onErrorMode,
  supportsErrorHandling,
  type FieldDef,
  type FlowNodeType,
} from '@/lib/flow-schema';
import { CONDITION_OPS } from '@/lib/flow-template';
import { i18nKey, preview } from './flow-ui';

export interface VariableOption {
  path: string;
  sample: unknown;
}

/** Datos del workspace para los selects (credenciales, flows, agentes). */
export interface EditorRefs {
  credentials: Array<{ id: string; name: string; type: string }>;
  flows: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  codeAvailable: boolean;
  flowId: string;
}

interface Props {
  nodeId: string;
  type: FlowNodeType;
  config: Record<string, unknown>;
  readOnly: boolean;
  variables: VariableOption[];
  refs: EditorRefs;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  /** Extra para triggers (URL del webhook, próxima corrida). */
  extra?: React.ReactNode;
}

type T = ReturnType<typeof useTranslations>;

function optionLabel(t: T, field: FieldDef, value: string): string {
  if (field.key === 'filterOp' || field.key === 'op') return t(`ops.${value}`);
  if (field.key === 'method') return value;
  if (value === '') return t('options.none');
  return t.has(`options.${value}`) ? t(`options.${value}`) : value;
}

/** Vista previa de las próximas corridas de un cron (o error). */
function CronPreview({ cron, timezone }: { cron: string; timezone: string }) {
  const t = useTranslations('flow.editor');
  const format = useFormatter();
  const runs = useMemo(() => nextCronRuns(cron, timezone || 'UTC', 3), [cron, timezone]);
  if (!cron.trim()) return null;
  if (runs.length === 0) return <p className="flow-field-error">{t('cronInvalid')}</p>;
  return (
    <p className="muted flow-hint" suppressHydrationWarning>
      {t('cronNext')}: {runs.map((d) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone || 'UTC' })).join(' · ')}
    </p>
  );
}

/** Botón { } con la lista de variables disponibles (nodos anteriores). */
function VariablePicker({ variables, onPick, disabled }: { variables: VariableOption[]; onPick: (p: string) => void; disabled: boolean }) {
  const t = useTranslations('flow.editor');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(
    () => variables.filter((v) => v.path.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80),
    [variables, q],
  );
  return (
    <span className="flow-var">
      <button
        type="button"
        className="flow-var-btn mono"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        title={t('insertVariable')}
        aria-label={t('insertVariable')}
      >
        {'{ }'}
      </button>
      {open && (
        <div className="flow-var-menu" role="dialog" aria-label={t('variables')}>
          <input
            className="input"
            autoFocus
            value={q}
            placeholder={t('searchVariables')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
          {list.length === 0 ? (
            <p className="muted flow-var-empty">{t('noVariables')}</p>
          ) : (
            <ul>
              {list.map((v) => (
                <li key={v.path}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(v.path);
                      setOpen(false);
                    }}
                  >
                    <span className="mono">{v.path}</span>
                    {v.sample !== undefined && <span className="muted">{preview(v.sample)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}

function TemplateInput({
  value,
  onChange,
  multiline,
  placeholder,
  variables,
  readOnly,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  variables: VariableOption[];
  readOnly: boolean;
  label: string;
  id: string;
}) {
  const pick = (p: string) => onChange(`${value}{{${p}}}`);
  return (
    <div className="flow-tpl">
      {multiline ? (
        <textarea
          id={id}
          className="textarea mono"
          rows={4}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input mono"
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <VariablePicker variables={variables} onPick={pick} disabled={readOnly} />
    </div>
  );
}

export default function NodeConfigPanel({ nodeId, type, config, readOnly, variables, refs, onChange, onDelete, extra }: Props) {
  const t = useTranslations('flow');
  const def = NODE_DEFS[type];
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const [jsonError, setJsonError] = useState<string | null>(null);

  /** Etiqueta del campo: la del nodo si la tiene (nodes.<tipo>.fields.x), si no la general. */
  function fieldLabel(key: string): string {
    const own = `nodes.${i18nKey(type)}.fields.${key}`;
    return t.has(own) ? t(own) : t(`fields.${key}`);
  }

  function renderField(field: FieldDef) {
    const id = `f-${nodeId}-${field.key}`;
    const label = fieldLabel(field.key);
    const value = config[field.key] ?? field.default;
    switch (field.kind) {
      case 'text':
      case 'textarea':
        if (field.template) {
          return (
            <TemplateInput
              id={id}
              label={label}
              value={String(value ?? '')}
              multiline={field.kind === 'textarea'}
              placeholder={field.placeholder}
              variables={variables}
              readOnly={readOnly}
              onChange={(v) => set(field.key, v)}
            />
          );
        }
        return field.kind === 'textarea' ? (
          <textarea
            id={id}
            className={field.key === 'code' ? 'textarea mono flow-code' : 'textarea'}
            rows={field.key === 'code' ? 10 : 3}
            spellCheck={field.key === 'code' ? false : undefined}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            readOnly={readOnly}
            onChange={(e) => set(field.key, e.target.value)}
          />
        ) : (
          <input
            id={id}
            className="input"
            value={String(value ?? '')}
            placeholder={field.placeholder}
            readOnly={readOnly}
            onChange={(e) => set(field.key, e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            id={id}
            className="input"
            type="number"
            value={value === undefined || value === null ? '' : String(value)}
            readOnly={readOnly}
            onChange={(e) => set(field.key, e.target.value === '' ? '' : Number(e.target.value))}
          />
        );
      case 'select':
        return (
          <select id={id} className="select" value={String(value ?? '')} disabled={readOnly} onChange={(e) => set(field.key, e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {optionLabel(t, field, o)}
              </option>
            ))}
          </select>
        );
      case 'event':
        return (
          <select id={id} className="select" value={String(value ?? '')} disabled={readOnly} onChange={(e) => set(field.key, e.target.value)}>
            {FLOW_EVENT_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {t(`events.${i18nKey(ev)}`)}
              </option>
            ))}
          </select>
        );
      case 'credential': {
        const types = (field.options ?? []) as readonly string[];
        const list = refs.credentials.filter((c) => types.includes(c.type));
        const current = String(value ?? '');
        const missing = current && !refs.credentials.some((c) => c.id === current);
        return (
          <>
            <select id={id} className="select" value={current} disabled={readOnly} onChange={(e) => set(field.key, e.target.value)}>
              <option value="">{t('editor.credentialNone')}</option>
              {missing && <option value={current}>{t('editor.credentialMissing')}</option>}
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {t(`credentials.types.${c.type}`)}
                </option>
              ))}
            </select>
            <p className="muted flow-hint">
              {list.length === 0 ? t('editor.credentialEmpty', { types: types.map((x) => t(`credentials.types.${x}`)).join(', ') }) : null}{' '}
              <Link href="/app/flow/credentials" className="flow-link">
                {t('editor.manageCredentials')}
              </Link>
            </p>
          </>
        );
      }
      case 'flowRef': {
        const current = String(value ?? '');
        return (
          <select id={id} className="select" value={current} disabled={readOnly} onChange={(e) => set(field.key, e.target.value)}>
            <option value="">{t('editor.pickFlow')}</option>
            {refs.flows
              .filter((f) => f.id !== refs.flowId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        );
      }
      case 'agentRef': {
        const current = String(value ?? '');
        return (
          <>
            <select id={id} className="select" value={current} disabled={readOnly} onChange={(e) => set(field.key, e.target.value)}>
              <option value="">{t('editor.pickAgent')}</option>
              {refs.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {refs.agents.length === 0 && (
              <p className="muted flow-hint">
                {t('editor.noAgents')}{' '}
                <Link href="/app/agents" className="flow-link">
                  {t('editor.createAgent')}
                </Link>
              </p>
            )}
          </>
        );
      }
      case 'cron':
        return (
          <>
            <input
              id={id}
              className="input mono"
              value={String(value ?? '')}
              placeholder={field.placeholder}
              readOnly={readOnly}
              onChange={(e) => set(field.key, e.target.value)}
            />
            <p className="muted flow-hint">{t('editor.cronHelp')}</p>
            <CronPreview cron={String(value ?? '')} timezone={String(config.timezone ?? 'UTC')} />
          </>
        );
      case 'bool':
        return (
          <label className="flow-check">
            <input id={id} type="checkbox" checked={value !== false} disabled={readOnly} onChange={(e) => set(field.key, e.target.checked)} />
            <span>{fieldLabel(`${field.key}Hint`)}</span>
          </label>
        );
      case 'json':
        return (
          <>
            <textarea
              id={id}
              className="textarea mono"
              rows={6}
              value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
              readOnly={readOnly}
              onChange={(e) => {
                set(field.key, e.target.value);
                try {
                  JSON.parse(e.target.value || '{}');
                  setJsonError(null);
                } catch {
                  setJsonError(t('editor.invalidJson'));
                }
              }}
            />
            {jsonError && <p className="flow-field-error">{jsonError}</p>}
          </>
        );
      case 'kv': {
        const rows = Array.isArray(value) ? (value as Array<{ key?: string; value?: string }>) : [];
        const update = (next: Array<{ key?: string; value?: string }>) => set(field.key, next);
        return (
          <div className="flow-rows">
            {rows.map((r, i) => (
              <div className="flow-kv" key={i}>
                <input
                  className="input mono"
                  value={r.key ?? ''}
                  placeholder={t('editor.kvKey')}
                  aria-label={t('editor.kvKey')}
                  readOnly={readOnly}
                  onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                />
                <TemplateInput
                  id={`${id}-${i}`}
                  label={t('editor.kvValue')}
                  value={String(r.value ?? '')}
                  placeholder={t('editor.kvValue')}
                  variables={variables}
                  readOnly={readOnly}
                  onChange={(v) => update(rows.map((x, j) => (j === i ? { ...x, value: v } : x)))}
                />
                {!readOnly && (
                  <button type="button" className="flow-icon-btn" aria-label={t('editor.remove')} onClick={() => update(rows.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="flow-add" onClick={() => update([...rows, { key: '', value: '' }])}>
                + {t('editor.addRow')}
              </button>
            )}
          </div>
        );
      }
      case 'conditions': {
        const rows = Array.isArray(value) ? (value as Array<{ left?: string; op?: string; right?: string }>) : [];
        const update = (next: typeof rows) => set(field.key, next);
        return (
          <div className="flow-rows">
            {rows.map((r, i) => (
              <div className="flow-cond" key={i}>
                <TemplateInput
                  id={`${id}-l${i}`}
                  label={t('editor.condLeft')}
                  value={String(r.left ?? '')}
                  placeholder="{{trigger.email}}"
                  variables={variables}
                  readOnly={readOnly}
                  onChange={(v) => update(rows.map((x, j) => (j === i ? { ...x, left: v } : x)))}
                />
                <select
                  className="select"
                  value={r.op ?? 'equals'}
                  disabled={readOnly}
                  aria-label={t('editor.condOp')}
                  onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}
                >
                  {CONDITION_OPS.map((op) => (
                    <option key={op} value={op}>
                      {t(`ops.${op}`)}
                    </option>
                  ))}
                </select>
                {!['exists', 'not_exists', 'is_true', 'is_false'].includes(r.op ?? '') && (
                  <TemplateInput
                    id={`${id}-r${i}`}
                    label={t('editor.condRight')}
                    value={String(r.right ?? '')}
                    placeholder={t('editor.condRight')}
                    variables={variables}
                    readOnly={readOnly}
                    onChange={(v) => update(rows.map((x, j) => (j === i ? { ...x, right: v } : x)))}
                  />
                )}
                {!readOnly && (
                  <button type="button" className="flow-icon-btn" aria-label={t('editor.remove')} onClick={() => update(rows.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="flow-add" onClick={() => update([...rows, { left: '', op: 'equals', right: '' }])}>
                + {t('editor.addCondition')}
              </button>
            )}
          </div>
        );
      }
      case 'cases': {
        const rows = Array.isArray(value) ? (value as unknown[]).map((v) => String(v ?? '')) : [];
        const update = (next: string[]) => set(field.key, next);
        return (
          <div className="flow-rows">
            {rows.map((r, i) => (
              <div className="flow-kv" key={i}>
                <input
                  className="input mono"
                  value={r}
                  aria-label={t('handles.case', { n: i + 1 })}
                  placeholder={t('handles.case', { n: i + 1 })}
                  readOnly={readOnly}
                  onChange={(e) => update(rows.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {!readOnly && (
                  <button type="button" className="flow-icon-btn" aria-label={t('editor.remove')} onClick={() => update(rows.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="flow-add" onClick={() => update([...rows, ''])}>
                + {t('editor.addCase')}
              </button>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  }

  const visibleFields = (def.fields as readonly FieldDef[]).filter((f) => {
    if (f.showIf) {
      const dep = (def.fields as readonly FieldDef[]).find((x) => x.key === f.showIf!.key);
      const current = String(config[f.showIf.key] ?? dep?.default ?? '');
      if (!f.showIf.values.includes(current)) return false;
    }
    if (type === 'trigger.event' && (f.key === 'filterOp' || f.key === 'filterValue') && !String(config.filterPath ?? '').trim()) {
      return false;
    }
    return true;
  });
  const errorMode = onErrorMode(config);

  return (
    <div className="flow-config">
      <div className="flow-config-head">
        <div>
          <p className="flow-config-cat">{t(`categories.${def.category}`)}</p>
          <h3>{t(`nodes.${i18nKey(type)}.title`)}</h3>
        </div>
        <span className="mono muted flow-config-id">{nodeId}</span>
      </div>
      <p className="muted flow-config-desc">{t(`nodes.${i18nKey(type)}.desc`)}</p>
      {type === 'data.code' && !refs.codeAvailable && (
        <p className="flow-note" role="note">
          {t('editor.codeUnavailable')}
        </p>
      )}
      {type === 'data.merge' && <p className="muted flow-hint">{t('editor.mergeHint')}</p>}
      {type === 'trigger.schedule' && <p className="muted flow-hint">{t('editor.scheduleGranularity')}</p>}
      {type === 'logic.delay' && <p className="muted flow-hint">{t('editor.delayGranularity')}</p>}
      {type === 'trigger.stripe' && <p className="muted flow-hint">{t('editor.stripeHint')}</p>}
      {extra}
      {visibleFields.map((f) => (
        <div className="flow-field" key={f.key}>
          {f.kind !== 'bool' && (
            <label className="label" htmlFor={`f-${nodeId}-${f.key}`}>
              {fieldLabel(f.key)}
            </label>
          )}
          {renderField(f)}
          {f.key === 'retries' && <p className="muted flow-hint">{t('editor.retryGranularity')}</p>}
        </div>
      ))}
      {supportsErrorHandling(type) && (
        <div className="flow-field flow-onerror">
          <label className="label" htmlFor={`f-${nodeId}-onError`}>
            {t('fields.onError')}
          </label>
          <select
            id={`f-${nodeId}-onError`}
            className="select"
            value={errorMode}
            disabled={readOnly}
            onChange={(e) => {
              const next: Record<string, unknown> = { ...config, onError: e.target.value };
              if (e.target.value === 'stop') delete next.onError;
              onChange(next);
            }}
          >
            {ON_ERROR_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`onError.${m}`)}
              </option>
            ))}
          </select>
          <p className="muted flow-hint">{t(`onError.${errorMode}Hint`)}</p>
        </div>
      )}
      {!readOnly && (
        <button type="button" className="btn btn-small btn-ghost flow-delete" onClick={onDelete}>
          {t('editor.deleteNode')}
        </button>
      )}
    </div>
  );
}
