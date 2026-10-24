'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { Workflow, WorkflowTriggerInput, WorkflowActionInput, TriggerType, ActionType } from '@/lib/crm-workflows';
import type { CrmWorkflowRunRow, CrmListRow } from '@/lib/db';
import {
  ACTION_GROUPS,
  TEMPLATE_KEYS,
  actionMissing,
  actionStepProblems,
  TRIGGER_GROUPS,
  buildTemplate,
  defaultActionConfig,
  normalizeActionConfig,
  webhookHeadersValid,
  workflowProblems,
  type WorkflowTemplateKey,
} from '@/lib/crm-workflow-catalog';
import RowTools from './RowTools';
import WorkflowRuns from './WorkflowRuns';

const BRANCH_OPS = ['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_set', 'is_not_set'] as const;
const ENTITIES = ['contact', 'company', 'deal'] as const;
const ACTIVITY_TYPES = ['note', 'call', 'meeting', 'email', 'task'] as const;

type Option = { id: string; name: string };

export interface WorkflowEditorProps {
  workflow: Workflow | null;
  lists: CrmListRow[];
  sequences?: Option[];
  forms?: Option[];
  flows?: Option[];
  /** Pipelines con sus etapas (trigger "Etapa cambiada"). */
  pipelines?: Array<{ id: string; name: string; stages: Option[] }>;
  /** Personas del workspace (responsable de la tarea). */
  owners?: Array<{ id: string; label: string }>;
  /** Lead scores del workspace (trigger "Score cambió"). */
  scores?: Array<{ id: string; name: string; isPrimary: boolean }>;
  runs: CrmWorkflowRunRow[];
  canEdit?: boolean;
}

type Ctx = Required<Omit<WorkflowEditorProps, 'workflow' | 'runs' | 'canEdit'>> & { canEdit: boolean; idBase: string; showErrors: boolean };

/**
 * Editor de workflows. Nuevo: asistente en tres pasos (Disparador →
 * Acciones → Revisar) con plantillas. Existente: el disparador y las acciones
 * como una lista numerada, y un solo Guardar. Los triggers y acciones van agrupados; webhook, Flow y si/si no
 * quedan en el grupo Avanzado.
 */
export default function WorkflowEditor({
  workflow,
  lists,
  sequences = [],
  forms = [],
  flows = [],
  pipelines = [],
  owners = [],
  scores = [],
  runs,
  canEdit = true,
}: WorkflowEditorProps) {
  const t = useTranslations('crm.workflows');
  const router = useRouter();
  const idBase = useId();
  const isNew = !workflow;
  const [name, setName] = useState(workflow?.name ?? '');
  const [nameTouched, setNameTouched] = useState(!!workflow);
  const [enabled, setEnabled] = useState(workflow?.enabled ?? true);
  const [triggers, setTriggers] = useState<WorkflowTriggerInput[]>(
    workflow?.triggers.length
      ? workflow.triggers.map((x) => ({ type: x.type, config: x.config, position: x.position }))
      : [{ type: 'contact_created', config: {} }],
  );
  const [actions, setActions] = useState<WorkflowActionInput[]>(
    workflow?.actions.length
      ? workflow.actions.map((a) => ({ type: a.type, config: a.config, position: a.position }))
      : isNew
        ? [{ type: 'create_task', config: defaultActionConfig('create_task') }]
        : [],
  );
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [running, setRunning] = useState(false);

  const ctx: Ctx = { lists, sequences, forms, flows, pipelines, owners, scores, canEdit, idBase, showErrors };
  const triggerLabel = (type: string) => (t.has(`triggerTypes.${type}`) ? t(`triggerTypes.${type}` as 'triggerTypes.manual') : type);
  const actionLabel = (type: string) => (t.has(`actionTypes.${type}`) ? t(`actionTypes.${type}` as 'actionTypes.webhook') : type);

  /** Nombre derivado mientras nadie lo escribió: "Deal ganado: crear tarea". */
  const derivedName = () =>
    triggers[0] && actions[0] ? t('derivedName', { trigger: triggerLabel(triggers[0].type), action: actionLabel(actions[0].type) }) : '';
  const effectiveName = nameTouched ? name : name || derivedName();

  const dirty = () => setState('dirty');

  function updateTrigger(i: number, patch: Partial<WorkflowTriggerInput>) {
    setTriggers((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    dirty();
  }
  function updateTriggerConfig(i: number, patch: Record<string, unknown>) {
    setTriggers((prev) => prev.map((x, j) => (j === i ? { ...x, config: { ...(x.config ?? {}), ...patch } } : x)));
    dirty();
  }
  function updateAction(i: number, patch: Partial<WorkflowActionInput>) {
    setActions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    dirty();
  }
  function updateActionConfig(i: number, patch: Record<string, unknown>) {
    setActions((prev) => prev.map((a, j) => (j === i ? { ...a, config: { ...(a.config ?? {}), ...patch } } : a)));
    dirty();
  }
  function moveAction(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    setActions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(i, 1);
      copy.splice(j, 0, moved);
      return copy.map((a, k) => ({ ...a, position: k }));
    });
    dirty();
  }
  function addAction() {
    setActions((prev) => [...prev, { type: 'create_task', config: defaultActionConfig('create_task') }]);
    dirty();
  }

  function applyTemplate(key: WorkflowTemplateKey) {
    const tpl = buildTemplate(key, {
      taskSubject: t('templates.copy.taskSubject'),
      emailSubject: t('templates.copy.emailSubject'),
      emailBody: t('templates.copy.emailBody'),
      notifyMessage: t('templates.copy.notifyMessage'),
      followUpSubject: t('templates.copy.followUpSubject'),
    });
    setTriggers([{ type: tpl.trigger, config: {} }]);
    setActions(tpl.actions.map((a, i) => ({ ...a, position: i })));
    if (!nameTouched) setName(t(`templates.${key}.title`));
    setStep(1);
    dirty();
  }

  const problems = workflowProblems({ name: effectiveName, triggers, actions });

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!canEdit || saving) return;
    // El asistente solo guarda desde Revisar: un submit en otro paso no crea nada.
    if (isNew && step !== 2) return;
    if (problems.length) {
      setShowErrors(true);
      setError(t(`problems.${problems[0]}`));
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: effectiveName.trim(),
      enabled,
      triggers: triggers.map((x, i) => ({ ...x, position: i })),
      actions: actions.map((a, i) => ({ ...a, config: normalizeActionConfig(a.type, a.config ?? {}), position: i })),
    };
    const res = await fetch(isNew ? '/api/crm/workflows' : `/api/crm/workflows/${workflow!.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(t('problems.save'));
      return;
    }
    const saved = (await res.json()) as Workflow;
    if (isNew) {
      router.push(`/app/crm/workflows/${saved.id}`);
    } else {
      setState('saved');
      router.refresh();
    }
  }

  async function run() {
    if (!workflow) return;
    setRunning(true);
    await fetch(`/api/crm/workflows/${workflow.id}/run`, { method: 'POST' }).catch(() => null);
    setRunning(false);
    router.refresh();
  }

  async function remove() {
    if (!workflow) return;
    const res = await fetch(`/api/crm/workflows/${workflow.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) router.push('/app/crm/workflows');
    else setError(t('problems.save'));
  }

  const triggerBlock = (
    <ol className="crm-steps" aria-label={t('triggers')}>
      {triggers.map((tr, i) => (
        <li key={i} className="crm-step crm-step-trigger">
          <span className="crm-step-n is-empty" aria-hidden="true" />
          <div className="crm-step-body">
            <div className="crm-step-head">
              <span className="crm-step-kicker">{i === 0 ? t('whenTrigger') : t('orWhen')}</span>
              {canEdit && triggers.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-danger btn-sm"
                  onClick={() => {
                    setTriggers((prev) => prev.filter((_, j) => j !== i));
                    dirty();
                  }}
                >
                  {t('removeTrigger')}
                </button>
              )}
            </div>
            <TriggerConfig
              trigger={tr}
              index={i}
              ctx={ctx}
              onType={(type) => updateTrigger(i, { type, config: {} })}
              onConfig={(patch) => updateTriggerConfig(i, patch)}
            />
          </div>
        </li>
      ))}
      {canEdit && (
        <li className="crm-step crm-step-add">
          <span className="crm-step-n is-empty" aria-hidden="true" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setTriggers((prev) => [...prev, { type: 'contact_created', config: {} }]);
              dirty();
            }}
          >
            {t('addTrigger')}
          </button>
        </li>
      )}
    </ol>
  );

  const actionBlock = (
    <ol className="crm-steps" aria-label={t('actions')}>
      {actions.length === 0 && (
        <li className="crm-step">
          <span className="crm-step-n is-empty" aria-hidden="true" />
          <p className="ui-help wf-empty" data-invalid={showErrors || undefined}>
            {t('noActions')}
          </p>
        </li>
      )}
      {actions.map((a, i) => {
        const afterBranch = a.type !== 'branch' && actions.slice(0, i).some((p) => p.type === 'branch');
        return (
          <li key={i} className="crm-step" data-testid="workflow-action">
            <span className="crm-step-n" aria-hidden="true">{i + 1}</span>
            <div className="crm-step-body">
              <div className="crm-step-head">
                <select
                  className="select wf-type"
                  value={a.type}
                  onChange={(e) => {
                    const type = e.target.value as ActionType;
                    updateAction(i, { type, config: defaultActionConfig(type) });
                  }}
                  aria-label={t('actionN', { n: i + 1 })}
                  disabled={!canEdit}
                >
                  {ACTION_GROUPS.map((g) => (
                    <optgroup key={g.key} label={t(`actionGroups.${g.key}`)}>
                      {g.types.map((type) => (
                        <option key={type} value={type}>
                          {actionLabel(type)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {canEdit && (
                  <RowTools
                    index={i}
                    count={actions.length}
                    onMove={(d) => moveAction(i, d)}
                    onRemove={() => {
                      setActions((prev) => prev.filter((_, j) => j !== i));
                      dirty();
                    }}
                    name={actionLabel(a.type)}
                  />
                )}
              </div>
              <ActionConfig
                type={a.type}
                config={a.config ?? {}}
                index={i}
                ctx={ctx}
                onChange={(patch) => updateActionConfig(i, patch)}
              />
              {afterBranch && (
                <div className="ui-field wf-when">
                  <label className="label" htmlFor={`${idBase}-when-${i}`}>
                    {t('when.label')}
                  </label>
                  <select
                    id={`${idBase}-when-${i}`}
                    className="select"
                    value={safeString(a.config?.when)}
                    onChange={(e) => updateActionConfig(i, { when: e.target.value })}
                    disabled={!canEdit}
                  >
                    <option value="">{t('when.always')}</option>
                    <option value="yes">{t('when.yes')}</option>
                    <option value="no">{t('when.no')}</option>
                  </select>
                </div>
              )}
            </div>
          </li>
        );
      })}
      {canEdit && (
        <li className="crm-step crm-step-add">
          <span className="crm-step-n is-empty" aria-hidden="true" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addAction} data-testid="workflow-add-action">
            {t('addAction')}
          </button>
        </li>
      )}
    </ol>
  );

  const nameField = (
    <div className="ui-fields-2 wf-meta">
      <div className="ui-field">
        <label className="label" htmlFor={`${idBase}-name`}>
          {t('name')}
        </label>
        <input
          id={`${idBase}-name`}
          className="input"
          value={effectiveName}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
            dirty();
          }}
          aria-invalid={(showErrors && problems.includes('name')) || undefined}
          disabled={!canEdit}
          maxLength={500}
        />
        {!nameTouched && <span className="ui-help">{t('nameDerived')}</span>}
      </div>
      <div className="ui-field">
        <span className="label" id={`${idBase}-state`}>
          {t('state')}
        </span>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              dirty();
            }}
            aria-describedby={`${idBase}-state`}
            disabled={!canEdit}
          />
          {enabled ? t('enabled') : t('disabled')}
        </label>
      </div>
    </div>
  );

  const note = saving
    ? t('saving')
    : error
      ? error
      : state === 'saved'
        ? t('saved')
        : state === 'dirty'
          ? t('unsaved')
          : !canEdit
            ? t('readOnly')
            : null;
  const noteTone = error ? 'error' : state === 'saved' ? 'ok' : undefined;

  // ---------- Asistente (workflow nuevo) ----------
  if (isNew) {
    const steps = [t('wizard.trigger'), t('wizard.actions'), t('wizard.review')];
    return (
      <form className="wf wf-wizard" onSubmit={save} noValidate>
        <ol className="wf-steps" aria-label={t('wizard.label')}>
          {steps.map((label, i) => (
            <li key={label} className="wf-steps-item" data-state={i < step ? 'done' : i === step ? 'current' : 'next'}>
              <button
                type="button"
                className="wf-steps-btn"
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                disabled={i > step}
              >
                <span className="wf-steps-n" aria-hidden="true">{i + 1}</span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="wf-panel" aria-labelledby={`${idBase}-s0`}>
            <h2 className="crm-panel-title" id={`${idBase}-s0`}>
              {t('wizard.pickTemplate')}
            </h2>
            <ul className="wf-templates">
              {TEMPLATE_KEYS.map((key) => (
                <li key={key}>
                  <button type="button" className="wf-template" onClick={() => applyTemplate(key)} data-testid={`workflow-template-${key}`}>
                    <span className="wf-template-title">{t(`templates.${key}.title`)}</span>
                    <span className="wf-template-desc">{t(`templates.${key}.desc`)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <h2 className="crm-panel-title">{t('wizard.orTrigger')}</h2>
            {triggerBlock}
          </section>
        )}

        {step === 1 && (
          <section className="wf-panel" aria-labelledby={`${idBase}-s1`}>
            <h2 className="crm-panel-title" id={`${idBase}-s1`}>
              {t('wizard.thenDo', { trigger: triggerLabel(triggers[0]?.type ?? '') })}
            </h2>
            {actionBlock}
          </section>
        )}

        {step === 2 && (
          <section className="wf-panel" aria-labelledby={`${idBase}-s2`}>
            <h2 className="crm-panel-title" id={`${idBase}-s2`}>
              {t('wizard.review')}
            </h2>
            {nameField}
            <ol className="crm-steps wf-summary" aria-label={t('wizard.summary')}>
              {triggers.map((tr, i) => (
                <li key={`t${i}`} className="crm-step crm-step-trigger">
                  <span className="crm-step-n is-empty" aria-hidden="true" />
                  <p className="wf-summary-text">
                    {i === 0 ? t('whenTrigger') : t('orWhen')} {triggerLabel(tr.type)}
                  </p>
                </li>
              ))}
              {actions.map((a, i) => (
                <li key={`a${i}`} className="crm-step">
                  <span className="crm-step-n" aria-hidden="true">{i + 1}</span>
                  <p className="wf-summary-text">
                    {actionLabel(a.type)}
                    {summaryDetail(a) && <span className="wf-summary-detail"> {summaryDetail(a)}</span>}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="crm-savebar">
          <p className="ui-section-note" role="status" aria-live="polite" data-tone={noteTone}>
            {error}
          </p>
          <span className="crm-savebar-actions">
            {step > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(step - 1)}>
                {t('wizard.back')}
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                key="next"
                onClick={() => {
                  const blocking = step === 1 ? actionStepProblems(actions) : [];
                  if (blocking.length) {
                    setShowErrors(true);
                    setError(t(`problems.${blocking[0]}`));
                    return;
                  }
                  setShowErrors(false);
                  setError(null);
                  setStep(step + 1);
                }}
                data-testid="workflow-wizard-next"
              >
                {t('wizard.next')}
              </button>
            ) : (
              <button
                key="create"
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void save()}
                aria-busy={saving || undefined}
                data-testid="workflow-create"
              >
                {t('wizard.create')}
              </button>
            )}
          </span>
        </div>
      </form>
    );
  }

  // ---------- Editor (workflow existente) ----------
  // En desktop van en la barra; en el celular, debajo del contenido (la barra queda con Guardar solo).
  const secondaryActions = (
    <>
      {confirmDelete ? (
        <>
          <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={remove}>
            {t('confirmDelete')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
            {t('cancel')}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
          {t('delete')}
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={run} aria-busy={running || undefined}>
        {t('runNow')}
      </button>
    </>
  );
  return (
    <div className="wf-page">
      <form className="wf" onSubmit={save} noValidate>
        <section className="ui-section">
          <div className="ui-section-body">{nameField}</div>
        </section>

        <section className="wf-panel" aria-labelledby={`${idBase}-trig`}>
          <h2 className="crm-panel-title" id={`${idBase}-trig`}>
            {t('triggers')}
          </h2>
          {triggerBlock}
        </section>

        <section className="wf-panel" aria-labelledby={`${idBase}-act`}>
          <h2 className="crm-panel-title" id={`${idBase}-act`}>
            {t('actions')}
          </h2>
          {actionBlock}
        </section>

        <div className="crm-savebar">
          <p className="ui-section-note" role="status" aria-live="polite" data-tone={noteTone}>
            {note}
          </p>
          {canEdit && (
            <span className="crm-savebar-actions">
              <span className="crm-savebar-secondary">{secondaryActions}</span>
              <button type="submit" className="btn btn-primary btn-sm" aria-busy={saving || undefined} data-testid="workflow-save">
                {t('saveWorkflow')}
              </button>
            </span>
          )}
        </div>
        {canEdit && <div className="crm-savebar-more">{secondaryActions}</div>}
      </form>

      <WorkflowRuns runs={runs} />
    </div>
  );

  function summaryDetail(a: WorkflowActionInput): string {
    const c = a.config ?? {};
    if (a.type === 'create_task' || a.type === 'send_email') return safeString(c.subject) ? `«${safeString(c.subject)}»` : '';
    if (a.type === 'notify_user') return safeString(c.message) ? `«${safeString(c.message)}»` : '';
    return '';
  }
}

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="ui-error" id={`${id}-err`}>
          {error}
        </span>
      ) : (
        help && <span className="ui-help">{help}</span>
      )}
    </div>
  );
}

function TriggerConfig({
  trigger,
  index,
  ctx,
  onType,
  onConfig,
}: {
  trigger: WorkflowTriggerInput;
  index: number;
  ctx: Ctx;
  onType: (type: TriggerType) => void;
  onConfig: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('crm.workflows');
  const id = (k: string) => `${ctx.idBase}-t${index}-${k}`;
  const cfg = trigger.config ?? {};
  const stageSelect = (key: 'fromStageId' | 'toStageId') => {
    const value = safeString(cfg[key]);
    const known = ctx.pipelines.some((p) => p.stages.some((s) => s.id === value));
    return (
      <Field id={id(key)} label={t(key === 'fromStageId' ? 'fromStage' : 'toStage')}>
        <select id={id(key)} className="select" value={value} onChange={(e) => onConfig({ [key]: e.target.value })} disabled={!ctx.canEdit}>
          <option value="">{t('anyStage')}</option>
          {value && !known && <option value={value}>{value}</option>}
          {ctx.pipelines.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {p.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
    );
  };

  return (
    <div className="wf-config">
      <select
        className="select wf-type"
        value={trigger.type}
        onChange={(e) => onType(e.target.value as TriggerType)}
        aria-label={t('triggerN', { n: index + 1 })}
        disabled={!ctx.canEdit}
        data-testid="workflow-trigger"
      >
        {TRIGGER_GROUPS.map((g) => (
          <optgroup key={g.key} label={t(`triggerGroups.${g.key}`)}>
            {g.types.map((type) => (
              <option key={type} value={type}>
                {t(`triggerTypes.${type}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {trigger.type === 'form_submitted' && (
        <div className="ui-fields-2">
          <Field id={id('form')} label={t('formId')}>
            <select id={id('form')} className="select" value={safeString(cfg.formId)} onChange={(e) => onConfig({ formId: e.target.value })} disabled={!ctx.canEdit}>
              <option value="">{t('anyForm')}</option>
              {ctx.forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {trigger.type === 'score_changed' && (
        <div className="ui-fields-2">
          {ctx.scores.length > 1 && (
            <Field id={id('score')} label={t('scoreId')}>
              <select
                id={id('score')}
                className="select"
                value={safeString(cfg.scoreId) || ctx.scores.find((x) => x.isPrimary)?.id || ''}
                onChange={(e) => onConfig({ scoreId: ctx.scores.find((x) => x.id === e.target.value)?.isPrimary ? '' : e.target.value })}
                disabled={!ctx.canEdit}
              >
                {ctx.scores.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id={id('threshold')} label={t('threshold')}>
            <input
              id={id('threshold')}
              className="input data"
              type="number"
              value={safeString(cfg.threshold)}
              onChange={(e) => onConfig({ threshold: e.target.value === '' ? '' : Number(e.target.value) })}
              disabled={!ctx.canEdit}
            />
          </Field>
          <Field id={id('dir')} label={t('directionLabel')}>
            <select id={id('dir')} className="select" value={safeString(cfg.direction) || 'up'} onChange={(e) => onConfig({ direction: e.target.value })} disabled={!ctx.canEdit}>
              {(['up', 'down', 'any'] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`direction.${d}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {trigger.type === 'deal_stage_changed' && (
        <div className="ui-fields-2">
          {stageSelect('fromStageId')}
          {stageSelect('toStageId')}
        </div>
      )}
    </div>
  );
}

function ActionConfig({
  type,
  config,
  index,
  ctx,
  onChange,
}: {
  type: ActionType;
  config: Record<string, unknown>;
  index: number;
  ctx: Ctx;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('crm.workflows');
  const tc = useTranslations('crm');
  const id = (k: string) => `${ctx.idBase}-a${index}-${k}`;
  const dis = !ctx.canEdit;
  const missing = ctx.showErrors ? actionMissing(type, config) : [];
  /** aria-invalid + mensaje para un campo obligatorio vacío. */
  const req = (k: string, fid: string) =>
    missing.includes(k) ? { 'aria-invalid': true as const, 'aria-describedby': `${fid}-err` } : {};
  const reqMsg = (k: string) => (missing.includes(k) ? t('problems.required') : undefined);
  const entitySelect = (k: string, withEmpty: boolean) => (
    <Field id={id(k)} label={t('entity')}>
      <select id={id(k)} className="select" value={safeString(config.entity) || (withEmpty ? '' : 'contact')} onChange={(e) => onChange({ entity: e.target.value })} disabled={dis}>
        {ENTITIES.map((en) => (
          <option key={en} value={en}>
            {t(`entities.${en}`)}
          </option>
        ))}
      </select>
    </Field>
  );

  switch (type) {
    case 'send_email': {
      const to = safeString(config.to);
      const toContact = to === 'contact';
      return (
        <div className="wf-config">
          <div className="ui-fields-2">
            <Field id={id('to')} label={tc('common.to')}>
              <select
                id={id('to')}
                className="select"
                value={toContact ? 'contact' : 'other'}
                onChange={(e) => onChange({ to: e.target.value === 'contact' ? 'contact' : '' })}
                disabled={dis}
              >
                <option value="contact">{t('toContact')}</option>
                <option value="other">{t('toOther')}</option>
              </select>
            </Field>
            {!toContact && (
              <Field id={id('to-addr')} label={t('toAddress')} help={t('toAddressHint')} error={reqMsg('to')}>
                <input id={id('to-addr')} className="input" {...req('to', id('to-addr'))} value={to} onChange={(e) => onChange({ to: e.target.value })} disabled={dis} />
              </Field>
            )}
          </div>
          <Field id={id('subject')} label={tc('common.subject')} error={reqMsg('subject')}>
            <input id={id('subject')} className="input" {...req('subject', id('subject'))} value={safeString(config.subject)} onChange={(e) => onChange({ subject: e.target.value })} disabled={dis} />
          </Field>
          <Field id={id('body')} label={tc('common.body')} help={t('variablesHint')} error={reqMsg('body')}>
            <textarea id={id('body')} className="textarea" rows={4} {...req('body', id('body'))} value={safeString(config.body)} onChange={(e) => onChange({ body: e.target.value })} disabled={dis} />
          </Field>
        </div>
      );
    }
    case 'create_task':
      return (
        <div className="wf-config">
          <Field id={id('subject')} label={t('taskTitle')} error={reqMsg('subject')}>
            <input id={id('subject')} className="input" {...req('subject', id('subject'))} value={safeString(config.subject)} onChange={(e) => onChange({ subject: e.target.value })} disabled={dis} />
          </Field>
          <div className="ui-fields-2">
            <Field id={id('due')} label={t('dueInDays')}>
              <input
                id={id('due')}
                className="input data"
                type="number"
                min={0}
                value={safeString(config.dueInDays)}
                onChange={(e) => onChange({ dueInDays: e.target.value === '' ? undefined : Number(e.target.value) })}
                disabled={dis}
              />
            </Field>
            <Field id={id('owner')} label={t('owner')}>
              <select id={id('owner')} className="select" value={safeString(config.ownerId)} onChange={(e) => onChange({ ownerId: e.target.value || undefined })} disabled={dis}>
                <option value="">{t('ownerDefault')}</option>
                {safeString(config.ownerId) && !ctx.owners.some((o) => o.id === config.ownerId) && (
                  <option value={safeString(config.ownerId)}>{safeString(config.ownerId)}</option>
                )}
                {ctx.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      );
    case 'create_activity':
      return (
        <div className="wf-config">
          <div className="ui-fields-2">
            <Field id={id('atype')} label={t('activityType')}>
              <select id={id('atype')} className="select" value={safeString(config.type) || 'note'} onChange={(e) => onChange({ type: e.target.value })} disabled={dis}>
                {ACTIVITY_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {tc(`enums.activityType.${at}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={id('subject')} label={tc('common.subject')}>
              <input id={id('subject')} className="input" value={safeString(config.subject)} onChange={(e) => onChange({ subject: e.target.value })} disabled={dis} />
            </Field>
          </div>
          <Field id={id('body')} label={tc('common.body')}>
            <textarea id={id('body')} className="textarea" rows={3} value={safeString(config.body)} onChange={(e) => onChange({ body: e.target.value })} disabled={dis} />
          </Field>
        </div>
      );
    case 'update_field':
      return (
        <div className="wf-config wf-config-3">
          {entitySelect('entity', false)}
          <Field id={id('field')} label={t('field')} help={t('fieldHint')} error={reqMsg('field')}>
            <input id={id('field')} className="input data" {...req('field', id('field'))} value={safeString(config.field)} onChange={(e) => onChange({ field: e.target.value })} disabled={dis} />
          </Field>
          <Field id={id('value')} label={t('value')}>
            <input id={id('value')} className="input" value={safeString(config.value)} onChange={(e) => onChange({ value: e.target.value })} disabled={dis} />
          </Field>
        </div>
      );
    case 'add_to_list':
      return (
        <div className="wf-config">
          <Field id={id('list')} label={t('listId')} error={reqMsg('listId')}>
            <select id={id('list')} className="select" {...req('listId', id('list'))} value={safeString(config.listId)} onChange={(e) => onChange({ listId: e.target.value })} disabled={dis}>
              <option value="">{t('pick')}</option>
              {ctx.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case 'webhook': {
      const headers = typeof config.headers === 'object' && config.headers ? JSON.stringify(config.headers) : safeString(config.headers);
      const valid = webhookHeadersValid(config.headers);
      return (
        <div className="wf-config">
          <div className="wf-config-url">
            <Field id={id('method')} label={t('method')}>
              <select id={id('method')} className="select" value={safeString(config.method) || 'POST'} onChange={(e) => onChange({ method: e.target.value })} disabled={dis}>
                {['POST', 'PUT', 'PATCH', 'GET'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={id('url')} label={t('url')} error={reqMsg('url')}>
              <input id={id('url')} className="input data" type="url" {...req('url', id('url'))} value={safeString(config.url)} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://" disabled={dis} />
            </Field>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={id('headers')}>
              {t('headers')}
            </label>
            <textarea
              id={id('headers')}
              className="textarea mono"
              rows={2}
              value={headers}
              onChange={(e) => onChange({ headers: e.target.value })}
              placeholder='{"authorization": "Bearer …"}'
              aria-invalid={!valid || undefined}
              aria-describedby={id('headers-help')}
              disabled={dis}
            />
            <span className={valid ? 'ui-help' : 'ui-error'} id={id('headers-help')}>
              {valid ? t('headersHint') : t('problems.headers')}
            </span>
          </div>
        </div>
      );
    }
    case 'notify_user':
      return (
        <div className="wf-config">
          <Field id={id('msg')} label={t('message')} help={t('variablesHint')} error={reqMsg('message')}>
            <textarea id={id('msg')} className="textarea" rows={2} {...req('message', id('msg'))} value={safeString(config.message)} onChange={(e) => onChange({ message: e.target.value })} disabled={dis} />
          </Field>
        </div>
      );
    case 'enroll_in_sequence':
      return (
        <div className="wf-config">
          <Field id={id('seq')} label={t('sequenceId')} error={reqMsg('sequenceId')}>
            <select id={id('seq')} className="select" {...req('sequenceId', id('seq'))} value={safeString(config.sequenceId)} onChange={(e) => onChange({ sequenceId: e.target.value })} disabled={dis}>
              <option value="">{t('pick')}</option>
              {ctx.sequences.map((sq) => (
                <option key={sq.id} value={sq.id}>
                  {sq.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case 'run_flow':
      return (
        <div className="wf-config">
          <Field id={id('flow')} label={t('flowId')} help={t('runFlowHint')} error={reqMsg('flowId')}>
            <select id={id('flow')} className="select" {...req('flowId', id('flow'))} value={safeString(config.flowId)} onChange={(e) => onChange({ flowId: e.target.value })} disabled={dis}>
              <option value="">{t('pick')}</option>
              {ctx.flows.map((fl) => (
                <option key={fl.id} value={fl.id}>
                  {fl.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case 'branch':
      return (
        <div className="wf-config">
          <div className="wf-config-branch">
            {entitySelect('bentity', false)}
            <Field id={id('bfield')} label={t('field')} error={reqMsg('field')}>
              <input id={id('bfield')} className="input data" {...req('field', id('bfield'))} value={safeString(config.field)} onChange={(e) => onChange({ field: e.target.value })} disabled={dis} />
            </Field>
            <Field id={id('op')} label={t('condition')}>
              <select id={id('op')} className="select" value={safeString(config.op) || 'equals'} onChange={(e) => onChange({ op: e.target.value })} disabled={dis}>
                {BRANCH_OPS.map((op) => (
                  <option key={op} value={op}>
                    {tc(`scoring.ops.${op}`)}
                  </option>
                ))}
              </select>
            </Field>
            {config.op !== 'is_set' && config.op !== 'is_not_set' && (
              <Field id={id('bvalue')} label={t('value')}>
                <input id={id('bvalue')} className="input" value={safeString(config.value)} onChange={(e) => onChange({ value: e.target.value })} disabled={dis} />
              </Field>
            )}
          </div>
          <p className="ui-help">{t('branchHint')}</p>
        </div>
      );
    default:
      return null;
  }
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}
