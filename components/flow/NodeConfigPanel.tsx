'use client';

import { useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { nextCronRuns } from '@/lib/cron';
import type { CredentialType } from '@/lib/flow-credentials-schema';
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
import CredentialDialog from './CredentialDialog';
import { changedCount, i18nKey, preview, robotInputRows, splitFields, type RobotRefInput } from './flow-ui';

export interface VariableOption {
  path: string;
  sample: unknown;
}

/** Datos del workspace para los selects (credenciales, flows, agentes). */
export interface EditorRefs {
  credentials: Array<{ id: string; name: string; type: string }>;
  flows: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  /** Robots del workspace con sus entradas (nodo Robots: correr robot). */
  robots?: Array<{ id: string; name: string; inputs: RobotRefInput[] }>;
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
  /** Credencial creada desde el modal del campo (se agrega a refs). */
  onCredentialCreated: (credential: { id: string; name: string; type: string }) => void;
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
  if (runs.length === 0) return <p className="ui-error">{t('cronInvalid')}</p>;
  return (
    <p className="ui-help" suppressHydrationWarning>
      {t('cronNext')}: {runs.map((d) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone || 'UTC' })).join(' · ')}
    </p>
  );
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Botón { } con la lista de variables disponibles (nodos anteriores). */
function VariablePicker({ variables, onPick, disabled }: { variables: VariableOption[]; onPick: (p: string) => void; disabled: boolean }) {
  const t = useTranslations('flow.editor');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const list = useMemo(
    () => variables.filter((v) => v.path.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80),
    [variables, q],
  );
  function close() {
    setOpen(false);
    btn.current?.focus();
  }
  return (
    <span className="flow-var">
      <button
        ref={btn}
        type="button"
        className="btn btn-secondary btn-icon flow-var-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        title={t('insertVariable')}
        aria-label={t('insertVariable')}
      >
        <span className="data" aria-hidden="true">
          {'{ }'}
        </span>
      </button>
      {open && (
        <div
          className="flow-var-menu"
          role="dialog"
          aria-label={t('variables')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <input
            className="input"
            autoFocus
            value={q}
            placeholder={t('searchVariables')}
            aria-label={t('searchVariables')}
            onChange={(e) => setQ(e.target.value)}
          />
          {list.length === 0 ? (
            <p className="ui-help flow-var-empty">{t('noVariables')}</p>
          ) : (
            <ul>
              {list.map((v) => (
                <li key={v.path}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(v.path);
                      close();
                    }}
                  >
                    <span className="data">{v.path}</span>
                    {v.sample !== undefined && <span className="flow-muted">{preview(v.sample)}</span>}
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

/** "Referencia: {{nodes.http_1.output}}" con copiar: así se usa la salida del nodo en variables. */
function NodeRef({ nodeId, trigger }: { nodeId: string; trigger: boolean }) {
  const t = useTranslations('flow.editor');
  const [copied, setCopied] = useState(false);
  const ref = trigger ? '{{trigger}}' : `{{nodes.${nodeId}.output}}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Sin portapapeles: el texto queda seleccionable.
    }
  }
  return (
    <p className="flow-config-ref">
      <span className="flow-muted">{t('nodeId')}:</span>
      <span className="data">{ref}</span>
      <button type="button" className="flow-link" onClick={() => void copy()} aria-label={t('copyNodeRef')}>
        <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
      </button>
    </p>
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
          className="textarea data"
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
          className="input data"
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

export default function NodeConfigPanel({
  nodeId,
  type,
  config,
  readOnly,
  variables,
  refs,
  onChange,
  onDelete,
  onCredentialCreated,
  extra,
}: Props) {
  const t = useTranslations('flow');
  const def = NODE_DEFS[type];
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const [jsonError, setJsonError] = useState<string | null>(null);
  /** Campo de credencial que abrió el modal "Crear credencial". */
  const [credFor, setCredFor] = useState<FieldDef | null>(null);

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
            className={field.key === 'code' ? 'textarea data flow-code' : 'textarea'}
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
        const alone = list.length === 0 && !current;
        // Solo, el botón toma el id del campo (el label lo enfoca) pero conserva su propio nombre accesible.
        const create = !readOnly && (
          <button
            type="button"
            id={alone ? id : undefined}
            aria-label={alone ? t('editor.createCredential') : undefined}
            className="btn btn-secondary"
            onClick={() => setCredFor(field)}
          >
            <IconPlus />
            {t('editor.createCredential')}
          </button>
        );
        // Sin credenciales del tipo: solo el botón; el select y Administrar aparecen cuando hay alguna.
        if (alone) return create || <p className="ui-help">{t('editor.credentialNone')}</p>;
        return (
          <>
            <div className="flow-cred-pick">
              <select
                id={id}
                className="select"
                value={current}
                disabled={readOnly}
                aria-invalid={missing ? true : undefined}
                onChange={(e) => set(field.key, e.target.value)}
              >
                <option value="">{t('editor.credentialNone')}</option>
                {missing && <option value={current}>{t('editor.credentialMissing')}</option>}
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {t(`credentials.types.${c.type}`)}
                  </option>
                ))}
              </select>
              {create}
            </div>
            <p className="ui-help">
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
              <p className="ui-help">
                {t('editor.noAgents')}{' '}
                <Link href="/app/agents" className="flow-link">
                  {t('editor.createAgent')}
                </Link>
              </p>
            )}
          </>
        );
      }
      case 'robotRef': {
        const robots = refs.robots ?? [];
        const current = String(value ?? '');
        const picked = robots.find((r) => r.id === current) ?? null;
        // Un id que no está en la lista: robot borrado, de otro workspace o una {{variable}}.
        const missing = current !== '' && !picked;
        return (
          <>
            <select
              id={id}
              className="select"
              value={current}
              disabled={readOnly}
              aria-invalid={missing && !current.includes('{{') ? true : undefined}
              onChange={(e) => {
                const next = robots.find((r) => r.id === e.target.value);
                const rows = Array.isArray(config.inputs) ? (config.inputs as Array<{ key?: string; value?: string }>) : [];
                onChange({ ...config, [field.key]: e.target.value, ...(next ? { inputs: robotInputRows(next.inputs, rows) } : {}) });
              }}
            >
              <option value="">{t('editor.pickRobot')}</option>
              {missing && <option value={current}>{current.includes('{{') ? current : t('editor.robotMissing')}</option>}
              {robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {robots.length === 0 ? (
              <p className="ui-help">
                {t('editor.noRobots')}{' '}
                <Link href="/app/robots" className="flow-link">
                  {t('editor.createRobot')}
                </Link>
              </p>
            ) : picked ? (
              <p className="ui-help">
                {picked.inputs.length === 0
                  ? t('editor.robotNoInputs')
                  : t('editor.robotInputs', {
                      list: picked.inputs.map((d) => (d.required ? `${d.name} *` : d.name)).join(', '),
                    })}{' '}
                <Link href={`/app/robots/${picked.id}`} className="flow-link">
                  {t('editor.openRobot')}
                </Link>
              </p>
            ) : null}
          </>
        );
      }
      case 'cron':
        return (
          <>
            <input
              id={id}
              className="input data"
              value={String(value ?? '')}
              placeholder={field.placeholder}
              readOnly={readOnly}
              onChange={(e) => set(field.key, e.target.value)}
            />
            <p className="ui-help">{t('editor.cronHelp')}</p>
            <CronPreview cron={String(value ?? '')} timezone={String(config.timezone ?? 'UTC')} />
          </>
        );
      case 'bool':
        return (
          <label className="ui-check">
            <input id={id} type="checkbox" checked={value !== false} disabled={readOnly} onChange={(e) => set(field.key, e.target.checked)} />
            <span>{fieldLabel(`${field.key}Hint`)}</span>
          </label>
        );
      case 'json':
        return (
          <>
            <textarea
              id={id}
              className="textarea data"
              rows={6}
              aria-invalid={jsonError ? true : undefined}
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
            {jsonError && <p className="ui-error">{jsonError}</p>}
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
                  className="input data"
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={t('editor.remove')}
                    title={t('editor.remove')}
                    onClick={() => update(rows.filter((_, j) => j !== i))}
                  >
                    <IconX />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm flow-add" onClick={() => update([...rows, { key: '', value: '' }])}>
                <IconPlus />
                {t('editor.addRow')}
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={t('editor.remove')}
                    title={t('editor.remove')}
                    onClick={() => update(rows.filter((_, j) => j !== i))}
                  >
                    <IconX />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm flow-add" onClick={() => update([...rows, { left: '', op: 'equals', right: '' }])}>
                <IconPlus />
                {t('editor.addCondition')}
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
                  className="input data"
                  value={r}
                  aria-label={t('handles.case', { n: i + 1 })}
                  placeholder={t('handles.case', { n: i + 1 })}
                  readOnly={readOnly}
                  onChange={(e) => update(rows.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={t('editor.remove')}
                    title={t('editor.remove')}
                    onClick={() => update(rows.filter((_, j) => j !== i))}
                  >
                    <IconX />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm flow-add" onClick={() => update([...rows, ''])}>
                <IconPlus />
                {t('editor.addCase')}
              </button>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  }

  const { basic, advanced } = splitFields(type, def.fields as readonly FieldDef[], config);
  const errorMode = onErrorMode(config);
  const hasErrorHandling = supportsErrorHandling(type);
  const changed = changedCount(advanced, config) + (errorMode !== 'stop' ? 1 : 0);
  const hasAdvanced = advanced.length > 0 || hasErrorHandling;

  function fieldBlock(f: FieldDef) {
    return (
      <div className="ui-field" key={f.key}>
        {f.kind !== 'bool' && (
          <label className="label" htmlFor={`f-${nodeId}-${f.key}`}>
            {fieldLabel(f.key)}
          </label>
        )}
        {renderField(f)}
        {f.key === 'retries' && <p className="ui-help">{t('editor.retryGranularity')}</p>}
      </div>
    );
  }

  return (
    <div className="flow-config">
      <div className="flow-config-head">
        <h2 className="flow-config-title">{t(`nodes.${i18nKey(type)}.title`)}</h2>
        <p className="ui-help">{t(`nodes.${i18nKey(type)}.desc`)}</p>
        <NodeRef nodeId={nodeId} trigger={type.startsWith('trigger.')} />
      </div>
      {type === 'data.code' && !refs.codeAvailable && (
        <p className="flow-note" role="note">
          {t('editor.codeUnavailable')}
        </p>
      )}
      {type === 'data.merge' && <p className="ui-help">{t('editor.mergeHint')}</p>}
      {type === 'trigger.schedule' && <p className="ui-help">{t('editor.scheduleGranularity')}</p>}
      {type === 'logic.delay' && <p className="ui-help">{t('editor.delayGranularity')}</p>}
      {type === 'trigger.stripe' && <p className="ui-help">{t('editor.stripeHint')}</p>}
      {extra}
      {basic.map(fieldBlock)}
      {hasAdvanced && (
        <AdvancedSection storageKey="flow.node" hint={changed > 0 ? t('editor.advancedChanged', { n: changed }) : undefined}>
          {advanced.map(fieldBlock)}
          {hasErrorHandling && (
            <div className="ui-field">
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
              <p className="ui-help">{t(`onError.${errorMode}Hint`)}</p>
            </div>
          )}
        </AdvancedSection>
      )}
      {!readOnly && (
        <div className="flow-config-foot">
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={onDelete}>
            {t('editor.deleteNode')}
          </button>
        </div>
      )}
      <CredentialDialog
        open={credFor !== null}
        types={(credFor?.options ?? []) as readonly CredentialType[]}
        existingNames={refs.credentials.map((c) => c.name)}
        onClose={() => setCredFor(null)}
        onSaved={(c) => {
          onCredentialCreated({ id: c.id, name: c.name, type: c.type });
          if (credFor) set(credFor.key, c.id);
          setCredFor(null);
        }}
      />
    </div>
  );
}
