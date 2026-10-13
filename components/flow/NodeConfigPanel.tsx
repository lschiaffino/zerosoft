'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FLOW_EVENT_TYPES,
  NODE_DEFS,
  type FieldDef,
  type FlowNodeType,
} from '@/lib/flow-schema';
import { CONDITION_OPS } from '@/lib/flow-template';
import { i18nKey, preview } from './flow-ui';

export interface VariableOption {
  path: string;
  sample: unknown;
}

interface Props {
  nodeId: string;
  type: FlowNodeType;
  config: Record<string, unknown>;
  readOnly: boolean;
  variables: VariableOption[];
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  /** Extra para triggers (URL del webhook, próxima corrida). */
  extra?: React.ReactNode;
}

type T = ReturnType<typeof useTranslations>;

function optionLabel(t: T, field: FieldDef, value: string): string {
  if (field.key === 'filterOp' || field.key === 'op') return t(`ops.${value}`);
  if (field.key === 'method') return value;
  return t.has(`options.${value}`) ? t(`options.${value}`) : value;
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

export default function NodeConfigPanel({ nodeId, type, config, readOnly, variables, onChange, onDelete, extra }: Props) {
  const t = useTranslations('flow');
  const def = NODE_DEFS[type];
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const [jsonError, setJsonError] = useState<string | null>(null);

  function renderField(field: FieldDef) {
    const id = `f-${nodeId}-${field.key}`;
    const label = t(`fields.${field.key}`);
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
          <textarea id={id} className="textarea" rows={3} value={String(value ?? '')} readOnly={readOnly} onChange={(e) => set(field.key, e.target.value)} />
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
      case 'bool':
        return (
          <label className="flow-check">
            <input id={id} type="checkbox" checked={value !== false} disabled={readOnly} onChange={(e) => set(field.key, e.target.checked)} />
            <span>{t(`fields.${field.key}Hint`)}</span>
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
    if (type === 'trigger.schedule') {
      const mode = config.mode ?? 'daily';
      if (mode === 'daily' && (f.key === 'every' || f.key === 'unit')) return false;
      if (mode === 'interval' && (f.key === 'time' || f.key === 'timezone')) return false;
    }
    if (type === 'trigger.event' && (f.key === 'filterOp' || f.key === 'filterValue') && !String(config.filterPath ?? '').trim()) {
      return false;
    }
    return true;
  });

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
      {extra}
      {visibleFields.map((f) => (
        <div className="flow-field" key={f.key}>
          {f.kind !== 'bool' && (
            <label className="label" htmlFor={`f-${nodeId}-${f.key}`}>
              {t(`fields.${f.key}`)}
            </label>
          )}
          {renderField(f)}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn btn-small btn-ghost flow-delete" onClick={onDelete}>
          {t('editor.deleteNode')}
        </button>
      )}
    </div>
  );
}
