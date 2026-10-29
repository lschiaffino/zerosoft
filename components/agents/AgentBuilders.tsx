'use client';

import { useTranslations } from 'next-intl';
import {
  AGENT_ANSWER_TYPES,
  AGENT_CODE_PARAM_TYPES,
  AGENT_CONDITION_OPS,
  AGENT_FORM_FIELD_TYPES,
  AGENT_FORM_MAX_FIELDS,
  AGENT_MAX_CODE_FUNCTIONS,
  AGENT_MAX_FORMS,
  AGENT_MAX_PROCEDURES,
  AGENT_PROCEDURE_MAX_STEPS,
  AGENT_PROCEDURE_STEP_KINDS,
  AGENT_PROCEDURE_TOOLS,
  type AgentCodeFunction,
  type AgentForm,
  type AgentFormField,
  type AgentProcedure,
  type AgentProcedureStep,
} from '@/lib/agents-config';
import { procedureIssues } from '@/lib/agents-procedures';
import { toolName } from './agents-ui';

type T = ReturnType<typeof useTranslations<'agents'>>;

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 40);
}

const splitList = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function move<X>(list: X[], i: number, delta: number): X[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const copy = list.slice();
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function blankStep(kind: AgentProcedureStep['kind'] = 'message'): AgentProcedureStep {
  return {
    id: newId('s'),
    kind,
    text: '',
    field: null,
    answerType: 'text',
    options: [],
    formId: null,
    condition: kind === 'branch' ? { field: '', op: 'equals', value: '' } : null,
    goto: null,
    tool: null,
    args: {},
  };
}

/** Argumentos de una acción como líneas "clave = valor" (con {{variable}}). */
function argsToText(args: Record<string, string>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
}
function textToArgs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

// ---------- Procedimientos ----------

export function ProceduresEditor({
  procedures,
  forms,
  enabledTools,
  readOnly,
  onChange,
}: {
  procedures: AgentProcedure[];
  forms: AgentForm[];
  enabledTools: string[];
  readOnly: boolean;
  onChange: (next: AgentProcedure[]) => void;
}) {
  const t = useTranslations('agents');
  const update = (i: number, patch: Partial<AgentProcedure>) => onChange(procedures.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () =>
    onChange([
      ...procedures,
      {
        id: newId('p'),
        name: t('procedures.newName'),
        trigger: '',
        keywords: [],
        steps: [{ ...blankStep('ask'), text: t('procedures.firstQuestion'), field: 'email', answerType: 'email' }, { ...blankStep('end'), text: t('procedures.lastMessage') }],
      },
    ]);
  return (
    <div className="ag-builder" data-testid="ag-procedures">
      {procedures.length === 0 && <p className="ui-help">{t('procedures.empty')}</p>}
      {procedures.map((p, i) => (
        <ProcedureItem
          key={p.id}
          t={t}
          procedure={p}
          forms={forms}
          enabledTools={enabledTools}
          readOnly={readOnly}
          onChange={(patch) => update(i, patch)}
          onRemove={() => onChange(procedures.filter((_, j) => j !== i))}
        />
      ))}
      {!readOnly && procedures.length < AGENT_MAX_PROCEDURES && (
        <button type="button" className="btn btn-secondary btn-sm ag-foot-start" onClick={add}>
          {t('procedures.add')}
        </button>
      )}
    </div>
  );
}

function ProcedureItem({
  t,
  procedure: p,
  forms,
  enabledTools,
  readOnly,
  onChange,
  onRemove,
}: {
  t: T;
  procedure: AgentProcedure;
  forms: AgentForm[];
  enabledTools: string[];
  readOnly: boolean;
  onChange: (patch: Partial<AgentProcedure>) => void;
  onRemove: () => void;
}) {
  const issues = procedureIssues(p, { enabledTools, formIds: forms.map((f) => f.id) });
  const setStep = (i: number, patch: Partial<AgentProcedureStep>) => onChange({ steps: p.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const base = `ag-proc-${p.id}`;
  return (
    <section className="ag-builder-item" aria-labelledby={`${base}-title`}>
      <div className="ag-builder-head">
        <h3 className="ag-builder-title" id={`${base}-title`}>
          {p.name || t('procedures.untitled')}
        </h3>
        {!readOnly && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`${t('procedures.remove')}: ${p.name}`}>
            {t('procedures.remove')}
          </button>
        )}
      </div>
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${base}-name`}>
            {t('procedures.name')}
          </label>
          <input id={`${base}-name`} className="input" maxLength={80} value={p.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${base}-kw`}>
            {t('procedures.keywords')}
          </label>
          <input
            id={`${base}-kw`}
            key={p.keywords.join(',')}
            className="input"
            defaultValue={p.keywords.join(', ')}
            disabled={readOnly}
            placeholder={t('procedures.keywordsPlaceholder')}
            onBlur={(e) => onChange({ keywords: splitList(e.target.value).slice(0, 10) })}
          />
        </div>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${base}-trigger`}>
          {t('procedures.trigger')}
        </label>
        <input
          id={`${base}-trigger`}
          className="input"
          maxLength={500}
          value={p.trigger}
          disabled={readOnly}
          placeholder={t('procedures.triggerPlaceholder')}
          onChange={(e) => onChange({ trigger: e.target.value })}
        />
        <p className="ui-help">{t('procedures.triggerHint')}</p>
      </div>
      <ol className="ag-steps" aria-label={t('procedures.steps')}>
        {p.steps.map((s, i) => (
          <li key={s.id} className="ag-step">
            <StepEditor
              t={t}
              step={s}
              index={i}
              steps={p.steps}
              forms={forms}
              readOnly={readOnly}
              issues={issues.filter((x) => x.stepId === s.id).map((x) => x.code)}
              onChange={(patch) => setStep(i, patch)}
              onMove={(d) => onChange({ steps: move(p.steps, i, d) })}
              onRemove={p.steps.length > 1 ? () => onChange({ steps: p.steps.filter((_, j) => j !== i) }) : undefined}
            />
          </li>
        ))}
      </ol>
      {!readOnly && p.steps.length < AGENT_PROCEDURE_MAX_STEPS && (
        <button type="button" className="btn btn-ghost btn-sm ag-foot-start" onClick={() => onChange({ steps: [...p.steps, blankStep()] })}>
          {t('procedures.addStep')}
        </button>
      )}
    </section>
  );
}

function StepEditor({
  t,
  step: s,
  index,
  steps,
  forms,
  readOnly,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  t: T;
  step: AgentProcedureStep;
  index: number;
  steps: AgentProcedureStep[];
  forms: AgentForm[];
  readOnly: boolean;
  issues: string[];
  onChange: (patch: Partial<AgentProcedureStep>) => void;
  onMove: (delta: number) => void;
  onRemove?: () => void;
}) {
  const id = `ag-step-${s.id}`;
  const textLabel =
    s.kind === 'ask' ? t('procedures.question') : s.kind === 'handoff' ? t('procedures.handoffReason') : s.kind === 'branch' || s.kind === 'action' ? null : t('procedures.message');
  return (
    <div className="ag-step-body">
      <div className="ag-step-row">
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-kind`}>
            {t('procedures.kind')}
          </label>
          <select
            id={`${id}-kind`}
            className="select"
            value={s.kind}
            disabled={readOnly}
            onChange={(e) => {
              const kind = e.target.value as AgentProcedureStep['kind'];
              onChange({ kind, condition: kind === 'branch' ? (s.condition ?? { field: '', op: 'equals', value: '' }) : s.condition });
            }}
          >
            {AGENT_PROCEDURE_STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`procedures.kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
        {(s.kind === 'ask' || s.kind === 'action' || s.kind === 'form') && (
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-field`}>
              {s.kind === 'action' ? t('procedures.resultVar') : t('procedures.saveAs')}
            </label>
            <input
              id={`${id}-field`}
              className="input data"
              maxLength={40}
              value={s.field ?? ''}
              disabled={readOnly}
              placeholder="email"
              onChange={(e) => onChange({ field: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || null })}
            />
          </div>
        )}
        {!readOnly && (
          <div className="ag-step-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('procedures.up')}>
              ↑
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={index === steps.length - 1} onClick={() => onMove(1)} aria-label={t('procedures.down')}>
              ↓
            </button>
            {onRemove && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
                {t('procedures.removeStep')}
              </button>
            )}
          </div>
        )}
      </div>
      {textLabel && (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-text`}>
            {textLabel}
          </label>
          <textarea id={`${id}-text`} className="textarea" rows={2} maxLength={1000} value={s.text} disabled={readOnly} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}
      {s.kind === 'ask' && (
        <div className="ag-step-row">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-type`}>
              {t('procedures.answerType')}
            </label>
            <select id={`${id}-type`} className="select" value={s.answerType} disabled={readOnly} onChange={(e) => onChange({ answerType: e.target.value as AgentProcedureStep['answerType'] })}>
              {AGENT_ANSWER_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`procedures.answerTypes.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-opts`}>
              {t('procedures.buttons')}
            </label>
            <input
              id={`${id}-opts`}
              key={s.options.join(',')}
              className="input"
              defaultValue={s.options.join(', ')}
              disabled={readOnly}
              placeholder={t('procedures.buttonsPlaceholder')}
              onBlur={(e) => onChange({ options: splitList(e.target.value).slice(0, 6) })}
            />
          </div>
        </div>
      )}
      {s.kind === 'form' && (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-form`}>
            {t('procedures.form')}
          </label>
          <select id={`${id}-form`} className="select" value={s.formId ?? ''} disabled={readOnly} onChange={(e) => onChange({ formId: e.target.value || null })}>
            <option value="">{t('tools.choose')}</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {s.kind === 'branch' && s.condition && (
        <div className="ag-step-row">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-cf`}>
              {t('procedures.ifVar')}
            </label>
            <input
              id={`${id}-cf`}
              className="input data"
              maxLength={80}
              value={s.condition.field}
              disabled={readOnly}
              placeholder="order.found"
              onChange={(e) => onChange({ condition: { ...s.condition!, field: e.target.value } })}
            />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-op`}>
              {t('procedures.op')}
            </label>
            <select
              id={`${id}-op`}
              className="select"
              value={s.condition.op}
              disabled={readOnly}
              onChange={(e) => onChange({ condition: { ...s.condition!, op: e.target.value as NonNullable<AgentProcedureStep['condition']>['op'] } })}
            >
              {AGENT_CONDITION_OPS.map((k) => (
                <option key={k} value={k}>
                  {t(`procedures.ops.${k}`)}
                </option>
              ))}
            </select>
          </div>
          {s.condition.op !== 'exists' && s.condition.op !== 'missing' && (
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-cv`}>
                {t('procedures.value')}
              </label>
              <input id={`${id}-cv`} className="input" maxLength={200} value={s.condition.value} disabled={readOnly} onChange={(e) => onChange({ condition: { ...s.condition!, value: e.target.value } })} />
            </div>
          )}
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-goto`}>
              {t('procedures.goto')}
            </label>
            <select id={`${id}-goto`} className="select" value={s.goto ?? ''} disabled={readOnly} onChange={(e) => onChange({ goto: e.target.value || null })}>
              <option value="">{t('tools.choose')}</option>
              {steps.map((x, j) =>
                x.id === s.id ? null : (
                  <option key={x.id} value={x.id}>
                    {t('procedures.stepN', { n: j + 1, kind: t(`procedures.kinds.${x.kind}`) })}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
      )}
      {s.kind === 'action' && (
        <>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-tool`}>
              {t('procedures.tool')}
            </label>
            <select id={`${id}-tool`} className="select" value={s.tool ?? ''} disabled={readOnly} onChange={(e) => onChange({ tool: (e.target.value || null) as AgentProcedureStep['tool'] })}>
              <option value="">{t('tools.choose')}</option>
              {AGENT_PROCEDURE_TOOLS.map((k) => (
                <option key={k} value={k}>
                  {toolName(t, k)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-args`}>
              {t('procedures.args')}
            </label>
            <textarea
              id={`${id}-args`}
              key={argsToText(s.args)}
              className="textarea data"
              rows={3}
              defaultValue={argsToText(s.args)}
              disabled={readOnly}
              placeholder={'email = {{email}}\nnote = {{reason}}'}
              onBlur={(e) => onChange({ args: textToArgs(e.target.value) })}
            />
            <p className="ui-help">{t('procedures.argsHint')}</p>
          </div>
        </>
      )}
      {issues.map((code) => (
        <p key={code} className="ag-issue" role="status">
          {t(`procedures.issues.${code}` as never)}
        </p>
      ))}
    </div>
  );
}

// ---------- Formularios ----------

function blankField(): AgentFormField {
  return { key: 'email', label: 'Email', type: 'email', required: true, options: [] };
}

export function FormsEditor({ forms, readOnly, onChange }: { forms: AgentForm[]; readOnly: boolean; onChange: (next: AgentForm[]) => void }) {
  const t = useTranslations('agents');
  const update = (i: number, patch: Partial<AgentForm>) => onChange(forms.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="ag-builder" data-testid="ag-forms">
      {forms.length === 0 && <p className="ui-help">{t('forms.empty')}</p>}
      {forms.map((f, i) => {
        const base = `ag-form-${f.id}`;
        const setField = (k: number, patch: Partial<AgentFormField>) => update(i, { fields: f.fields.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
        const noEmail = f.saveToCrm && !f.fields.some((x) => x.type === 'email');
        return (
          <section key={f.id} className="ag-builder-item" aria-labelledby={`${base}-title`}>
            <div className="ag-builder-head">
              <h3 className="ag-builder-title" id={`${base}-title`}>
                {f.name || t('forms.untitled')}
              </h3>
              {!readOnly && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(forms.filter((_, j) => j !== i))} aria-label={`${t('forms.remove')}: ${f.name}`}>
                  {t('forms.remove')}
                </button>
              )}
            </div>
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`${base}-name`}>
                  {t('forms.name')}
                </label>
                <input id={`${base}-name`} className="input" maxLength={80} value={f.name} disabled={readOnly} onChange={(e) => update(i, { name: e.target.value })} />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${base}-title-in`}>
                  {t('forms.formTitle')}
                </label>
                <input id={`${base}-title-in`} className="input" maxLength={200} value={f.title} disabled={readOnly} onChange={(e) => update(i, { title: e.target.value })} />
              </div>
            </div>
            <label className="ui-switch">
              <input type="checkbox" role="switch" checked={f.saveToCrm} disabled={readOnly} onChange={(e) => update(i, { saveToCrm: e.target.checked })} />
              {t('forms.saveToCrm')}
            </label>
            {noEmail && <p className="ag-issue">{t('forms.needsEmail')}</p>}
            <ol className="ag-steps" aria-label={t('forms.fields')}>
              {f.fields.map((x, k) => (
                <li key={`${f.id}-${k}`} className="ag-step">
                  <div className="ag-step-body">
                    <div className="ag-step-row">
                      <div className="ui-field">
                        <label className="label" htmlFor={`${base}-l${k}`}>
                          {t('forms.label')}
                        </label>
                        <input id={`${base}-l${k}`} className="input" maxLength={80} value={x.label} disabled={readOnly} onChange={(e) => setField(k, { label: e.target.value })} />
                      </div>
                      <div className="ui-field">
                        <label className="label" htmlFor={`${base}-k${k}`}>
                          {t('forms.key')}
                        </label>
                        <input
                          id={`${base}-k${k}`}
                          className="input data"
                          maxLength={40}
                          value={x.key}
                          disabled={readOnly}
                          onChange={(e) => setField(k, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                        />
                      </div>
                      <div className="ui-field">
                        <label className="label" htmlFor={`${base}-t${k}`}>
                          {t('forms.type')}
                        </label>
                        <select id={`${base}-t${k}`} className="select" value={x.type} disabled={readOnly} onChange={(e) => setField(k, { type: e.target.value as AgentFormField['type'] })}>
                          {AGENT_FORM_FIELD_TYPES.map((ty) => (
                            <option key={ty} value={ty}>
                              {t(`forms.types.${ty}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {x.type === 'select' && (
                      <div className="ui-field">
                        <label className="label" htmlFor={`${base}-o${k}`}>
                          {t('forms.options')}
                        </label>
                        <input id={`${base}-o${k}`} key={x.options.join(',')} className="input" defaultValue={x.options.join(', ')} disabled={readOnly} onBlur={(e) => setField(k, { options: splitList(e.target.value).slice(0, 20) })} />
                      </div>
                    )}
                    <div className="ag-step-row">
                      <label className="ui-check">
                        <input type="checkbox" checked={x.required} disabled={readOnly} onChange={(e) => setField(k, { required: e.target.checked })} /> {t('forms.required')}
                      </label>
                      {!readOnly && f.fields.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(i, { fields: f.fields.filter((_, j) => j !== k) })}>
                          {t('forms.removeField')}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {!readOnly && f.fields.length < AGENT_FORM_MAX_FIELDS && (
              <button
                type="button"
                className="btn btn-ghost btn-sm ag-foot-start"
                onClick={() => update(i, { fields: [...f.fields, { key: `field${f.fields.length + 1}`, label: t('forms.newField'), type: 'text', required: false, options: [] }] })}
              >
                {t('forms.addField')}
              </button>
            )}
          </section>
        );
      })}
      {!readOnly && forms.length < AGENT_MAX_FORMS && (
        <button
          type="button"
          className="btn btn-secondary btn-sm ag-foot-start"
          onClick={() =>
            onChange([
              ...forms,
              {
                id: newId('f'),
                name: t('forms.newName'),
                title: '',
                submitLabel: '',
                saveToCrm: true,
                fields: [{ key: 'name', label: t('forms.nameField'), type: 'text', required: true, options: [] }, blankField()],
              },
            ])
          }
        >
          {t('forms.add')}
        </button>
      )}
    </div>
  );
}

// ---------- Funciones de código ----------

export function CodeFunctionsEditor({
  functions,
  readOnly,
  available,
  onChange,
}: {
  functions: AgentCodeFunction[];
  readOnly: boolean;
  available: boolean;
  onChange: (next: AgentCodeFunction[]) => void;
}) {
  const t = useTranslations('agents');
  const update = (i: number, patch: Partial<AgentCodeFunction>) => onChange(functions.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="ag-builder" data-testid="ag-code">
      {!available && (
        <p className="ui-help ag-warn-inline" role="note">
          {t('code.unavailable')}
        </p>
      )}
      {functions.length === 0 && <p className="ui-help">{t('code.empty')}</p>}
      {functions.map((f, i) => {
        const base = `ag-fn-${f.id}`;
        return (
          <section key={f.id} className="ag-builder-item" aria-labelledby={`${base}-title`}>
            <div className="ag-builder-head">
              <h3 className="ag-builder-title data" id={`${base}-title`}>
                {f.name}({f.params.map((p) => p.name).join(', ')})
              </h3>
              {!readOnly && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(functions.filter((_, j) => j !== i))} aria-label={`${t('code.remove')}: ${f.name}`}>
                  {t('code.remove')}
                </button>
              )}
            </div>
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`${base}-name`}>
                  {t('code.name')}
                </label>
                <input
                  id={`${base}-name`}
                  className="input data"
                  maxLength={40}
                  value={f.name}
                  disabled={readOnly}
                  onChange={(e) => update(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${base}-params`}>
                  {t('code.params')}
                </label>
                <input
                  id={`${base}-params`}
                  key={f.params.map((p) => `${p.name}:${p.type}`).join(',')}
                  className="input data"
                  defaultValue={f.params.map((p) => `${p.name}:${p.type}`).join(', ')}
                  disabled={readOnly}
                  placeholder="amount:number, country:string"
                  onBlur={(e) =>
                    update(i, {
                      params: splitList(e.target.value)
                        .slice(0, 8)
                        .flatMap((x) => {
                          const [name, type] = x.split(':').map((y) => y.trim());
                          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name ?? '')) return [];
                          const ty = (AGENT_CODE_PARAM_TYPES as readonly string[]).includes(type ?? '') ? (type as AgentCodeFunction['params'][number]['type']) : 'string';
                          return [{ name, type: ty, description: '' }];
                        }),
                    })
                  }
                />
              </div>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${base}-desc`}>
                {t('code.description')}
              </label>
              <input id={`${base}-desc`} className="input" maxLength={500} value={f.description} disabled={readOnly} onChange={(e) => update(i, { description: e.target.value })} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${base}-code`}>
                {t('code.code')}
              </label>
              <textarea id={`${base}-code`} className="textarea ag-code" rows={8} spellCheck={false} maxLength={20_000} value={f.code} disabled={readOnly} onChange={(e) => update(i, { code: e.target.value })} />
              <p className="ui-help">{t('code.codeHint')}</p>
            </div>
          </section>
        );
      })}
      {!readOnly && functions.length < AGENT_MAX_CODE_FUNCTIONS && (
        <button
          type="button"
          className="btn btn-secondary btn-sm ag-foot-start"
          onClick={() =>
            onChange([
              ...functions,
              {
                id: newId('c'),
                name: `function_${functions.length + 1}`,
                description: '',
                params: [{ name: 'amount', type: 'number', description: '' }],
                code: 'return { total: Math.round(input.amount * 1.21 * 100) / 100 };',
                timeoutSec: 10,
              },
            ])
          }
        >
          {t('code.add')}
        </button>
      )}
    </div>
  );
}
