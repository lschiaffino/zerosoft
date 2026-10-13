'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { RobotDto, RobotRunDto, RobotUsage } from '@/lib/robots';
import {
  countSteps,
  MAX_ROBOT_STEPS,
  MAX_TIMEOUT_SEC,
  type RobotInputDef,
  type RobotSchedule,
  type RobotStep,
} from '@/lib/robots-schema';
import StepList from './StepList';
import RunsPanel from './RunsPanel';
import { errorText, RunnerNote, UsageMeter } from './robots-ui';

type Tab = 'steps' | 'inputs' | 'runs' | 'settings';

interface Props {
  robot: RobotDto;
  runs: RobotRunDto[];
  usage: RobotUsage;
  canEdit: boolean;
}

/** Editor de un robot: pasos, entradas, corridas y ajustes. */
export default function RobotEditor({ robot: initial, runs: initialRuns, usage: initialUsage, canEdit }: Props) {
  const t = useTranslations('robots');
  const format = useFormatter();
  const router = useRouter();
  const [robot, setRobot] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [steps, setSteps] = useState<RobotStep[]>(initial.steps);
  const [inputs, setInputs] = useState<RobotInputDef[]>(initial.inputs);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [schedule, setSchedule] = useState<RobotSchedule>(initial.schedule);
  const [timeoutSec, setTimeoutSec] = useState(initial.timeoutSec);
  const [runs, setRuns] = useState(initialRuns);
  const [usage, setUsage] = useState(initialUsage);
  const [selectedRun, setSelectedRun] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('steps');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidIndex, setInvalidIndex] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runValues, setRunValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const readOnly = !canEdit;

  const payload = useMemo(
    () => ({ name, description, steps, inputs, enabled, schedule, timeoutSec }),
    [name, description, steps, inputs, enabled, schedule, timeoutSec],
  );
  const dirty =
    JSON.stringify(payload) !==
    JSON.stringify({
      name: robot.name,
      description: robot.description,
      steps: robot.steps,
      inputs: robot.inputs,
      enabled: robot.enabled,
      schedule: robot.schedule,
      timeoutSec: robot.timeoutSec,
    });

  async function save(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setInvalidIndex(null);
    const res = await fetch(`/api/robots/${robot.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { robot?: RobotDto; error?: string; index?: number } | null;
    setSaving(false);
    if (!res?.ok || !data?.robot) {
      const idx = typeof data?.index === 'number' ? data.index : null;
      setInvalidIndex(idx);
      if (idx !== null) setTab('steps');
      setError(errorText(t, data?.error, { index: (idx ?? 0) + 1 }));
      return false;
    }
    setRobot(data.robot);
    setSteps(data.robot.steps);
    setInputs(data.robot.inputs);
    setSavedAt(Date.now());
    return true;
  }

  function openRun() {
    const values: Record<string, string> = {};
    for (const d of inputs) values[d.name] = d.default ?? '';
    setRunValues(values);
    setRunOpen(true);
  }

  async function run() {
    if (dirty && !(await save())) {
      setRunOpen(false);
      return;
    }
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/robots/${robot.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: runValues }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { run?: RobotRunDto; error?: string; name?: string } | null;
    setRunning(false);
    setRunOpen(false);
    if (!res?.ok || !data?.run) {
      setError(errorText(t, data?.error, { name: data?.name ?? '' }));
      return;
    }
    const newRun = data.run;
    setRuns((list) => [newRun, ...list]);
    setSelectedRun(newRun.id);
    setTab('runs');
    const u = await fetch('/api/robots')
      .then((r) => r.json() as Promise<{ usage?: RobotUsage }>)
      .catch(() => null);
    if (u?.usage) setUsage(u.usage);
  }

  async function remove() {
    if (!window.confirm(t('editor.confirmDelete'))) return;
    const res = await fetch(`/api/robots/${robot.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    router.push('/app/robots');
  }

  const stepCount = countSteps(steps);

  return (
    <div className="app-page robots-editor">
      <div className="robots-editor-head">
        <Link href="/app/robots" className="robots-back">
          ← {t('editor.back')}
        </Link>
        <div className="robots-editor-title">
          <input
            className="robots-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={readOnly}
            aria-label={t('editor.namePlaceholder')}
            placeholder={t('editor.namePlaceholder')}
            maxLength={120}
          />
          <input
            className="robots-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={readOnly}
            aria-label={t('editor.descriptionPlaceholder')}
            placeholder={t('editor.descriptionPlaceholder')}
            maxLength={1000}
          />
        </div>
        {canEdit && (
          <div className="robots-editor-actions">
            <span className="muted robots-save-state" aria-live="polite">
              {saving ? t('editor.saving') : dirty ? t('editor.unsaved') : savedAt ? t('editor.saved') : ''}
            </span>
            <button type="button" className="btn btn-small btn-ghost" onClick={remove}>
              {t('editor.delete')}
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => void save()} disabled={!dirty || saving}>
              {t('editor.save')}
            </button>
            <button
              type="button"
              className="btn btn-small btn-solid robots-run-btn"
              onClick={openRun}
              disabled={running || usage.backend === 'none'}
            >
              {running ? t('editor.running') : t('editor.run')}
            </button>
          </div>
        )}
      </div>

      {readOnly && <p className="muted robots-note">{t('editor.readOnly')}</p>}
      {error && (
        <p className="robots-error" role="alert">
          {error}
        </p>
      )}

      <div className="robots-tabs" role="tablist">
        {(['steps', 'inputs', 'runs', 'settings'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {t(`editor.tabs.${k}`)}
            {k === 'steps' && <span className="robots-tab-count">{stepCount}</span>}
            {k === 'runs' && runs.length > 0 && <span className="robots-tab-count">{runs.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'steps' && (
        <div className="robots-steps-layout">
          <div>
            <p className="muted robots-count">{t('steps.count', { count: stepCount, max: MAX_ROBOT_STEPS })}</p>
            <StepList steps={steps} onChange={setSteps} readOnly={readOnly} invalidIndex={invalidIndex} />
          </div>
          <aside className="robots-tips">
            <h3 className="robots-section-title">{t('steps.tipsTitle')}</h3>
            <ul>
              {(t.raw('steps.tips') as string[]).map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
            <p className="muted">
              {t('steps.templateHint', {
                inputs: '{{inputs.x}}',
                vars: '{{vars.x}}',
                loopItem: '{{loop.item}}',
              })}
            </p>
          </aside>
        </div>
      )}

      {tab === 'inputs' && (
        <InputsEditor inputs={inputs} onChange={setInputs} readOnly={readOnly} />
      )}

      {tab === 'runs' && <RunsPanel runs={runs} selectedId={selectedRun} onSelect={setSelectedRun} />}

      {tab === 'settings' && (
        <div className="robots-settings">
          <div className="robots-strip">
            <UsageMeter usage={usage} />
            <RunnerNote backend={usage.backend} />
          </div>
          <label className="robots-check">
            <input type="checkbox" checked={enabled} disabled={readOnly} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              {t('settings.enabled')}
              <small className="muted">{t('settings.enabledHint')}</small>
            </span>
          </label>

          <fieldset className="robots-fieldset">
            <div className="robots-fields">
              <label className="robots-field">
                <span>{t('settings.schedule')}</span>
                <select
                  className="select"
                  disabled={readOnly}
                  value={schedule?.mode ?? 'none'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSchedule(
                      v === 'none'
                        ? null
                        : {
                            mode: v as 'daily' | 'interval',
                            time: schedule?.time ?? '09:00',
                            timezone: schedule?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
                            every: schedule?.every ?? 24,
                            unit: 'hours',
                          },
                    );
                  }}
                >
                  <option value="none">{t('settings.scheduleNone')}</option>
                  <option value="daily">{t('settings.scheduleDaily')}</option>
                  <option value="interval">{t('settings.scheduleInterval')}</option>
                </select>
              </label>
              {schedule?.mode === 'daily' && (
                <>
                  <label className="robots-field">
                    <span>{t('settings.time')}</span>
                    <input className="input" value={schedule.time} readOnly={readOnly} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
                  </label>
                  <label className="robots-field">
                    <span>{t('settings.timezone')}</span>
                    <input className="input" value={schedule.timezone} readOnly={readOnly} onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })} />
                  </label>
                </>
              )}
              {schedule?.mode === 'interval' && (
                <label className="robots-field">
                  <span>{t('settings.every')}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={168}
                    value={schedule.every}
                    readOnly={readOnly}
                    onChange={(e) => setSchedule({ ...schedule, every: Math.min(168, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                  />
                </label>
              )}
            </div>
            {robot.nextRunAt && robot.enabled && robot.schedule && (
              <p className="muted robots-hint" suppressHydrationWarning>
                {t('settings.nextRun', { date: format.dateTime(new Date(robot.nextRunAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
              </p>
            )}
          </fieldset>

          <label className="robots-field robots-timeout">
            <span>{t('settings.timeout')}</span>
            <input
              className="input"
              type="number"
              min={10}
              max={MAX_TIMEOUT_SEC}
              value={timeoutSec}
              readOnly={readOnly}
              onChange={(e) => setTimeoutSec(Math.min(MAX_TIMEOUT_SEC, Math.max(10, Math.floor(Number(e.target.value) || 10))))}
            />
            <small className="muted">{t('settings.timeoutHint', { max: MAX_TIMEOUT_SEC })}</small>
          </label>

          <div className="robots-flow">
            <h3 className="robots-section-title">{t('settings.flowTitle')}</h3>
            <p className="muted">{t('settings.flowHint')}</p>
            <div className="robots-id-row">
              <code className="mono">{robot.id}</code>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(robot.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? t('settings.copied') : t('settings.copyId')}
              </button>
            </div>
          </div>

          <p className="robots-warning" role="note">
            {t('settings.responsible')}
          </p>
        </div>
      )}

      {runOpen && (
        <div className="robots-modal-backdrop" role="presentation" onClick={() => !running && setRunOpen(false)}>
          <div
            className="robots-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="robots-run-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="robots-run-title">{t('run.title', { name })}</h2>
            <p className="muted">{t('run.desc', { seconds: timeoutSec })}</p>
            {inputs.length === 0 ? (
              <p className="muted">{t('run.noInputs')}</p>
            ) : (
              <div className="robots-run-inputs">
                {inputs.map((d) => (
                  <label key={d.name} className="robots-field is-wide">
                    <span>
                      {d.label || d.name}
                      {d.required ? ' *' : ''} <code className="muted">{d.name}</code>
                    </span>
                    {d.kind === 'list' ? (
                      <textarea
                        className="textarea mono"
                        rows={4}
                        value={runValues[d.name] ?? ''}
                        onChange={(e) => setRunValues({ ...runValues, [d.name]: e.target.value })}
                      />
                    ) : (
                      <input
                        className="input"
                        value={runValues[d.name] ?? ''}
                        onChange={(e) => setRunValues({ ...runValues, [d.name]: e.target.value })}
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className="robots-modal-actions">
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setRunOpen(false)} disabled={running}>
                {t('run.cancel')}
              </button>
              <button type="button" className="btn btn-small btn-solid" onClick={() => void run()} disabled={running}>
                {running ? t('editor.running') : t('run.start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InputsEditor({
  inputs,
  onChange,
  readOnly,
}: {
  inputs: RobotInputDef[];
  onChange: (v: RobotInputDef[]) => void;
  readOnly: boolean;
}) {
  const t = useTranslations('robots.inputs');
  const set = (i: number, patch: Partial<RobotInputDef>) => onChange(inputs.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <div className="robots-inputs">
      <p className="muted">{t('desc', { example: '{{inputs.name}}' })}</p>
      <p className="robots-warning" role="note">
        {t('passwordWarning')}
      </p>
      {inputs.length === 0 ? (
        <p className="muted">{t('empty')}</p>
      ) : (
        <div className="robots-input-table">
          <div className="robots-input-row robots-row-head">
            <span>{t('name')}</span>
            <span>{t('label')}</span>
            <span>{t('kind')}</span>
            <span>{t('default')}</span>
            <span>{t('required')}</span>
            <span />
          </div>
          {inputs.map((d, i) => (
            <div className="robots-input-row" key={i}>
              <input className="input mono" value={d.name} readOnly={readOnly} aria-label={t('name')} onChange={(e) => set(i, { name: e.target.value })} />
              <input className="input" value={d.label} readOnly={readOnly} aria-label={t('label')} onChange={(e) => set(i, { label: e.target.value })} />
              <select className="select" value={d.kind} disabled={readOnly} aria-label={t('kind')} onChange={(e) => set(i, { kind: e.target.value as 'text' | 'list' })}>
                <option value="text">{t('kinds.text')}</option>
                <option value="list">{t('kinds.list')}</option>
              </select>
              {d.kind === 'list' ? (
                <textarea className="textarea mono" rows={2} value={d.default} readOnly={readOnly} aria-label={t('default')} onChange={(e) => set(i, { default: e.target.value })} />
              ) : (
                <input className="input" value={d.default} readOnly={readOnly} aria-label={t('default')} onChange={(e) => set(i, { default: e.target.value })} />
              )}
              <input type="checkbox" checked={d.required} disabled={readOnly} aria-label={t('required')} onChange={(e) => set(i, { required: e.target.checked })} />
              {!readOnly ? (
                <button type="button" className="robots-icon-btn" aria-label={t('remove')} title={t('remove')} onClick={() => onChange(inputs.filter((_, k) => k !== i))}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => onChange([...inputs, { name: `input${inputs.length + 1}`, label: '', kind: 'text', default: '', required: false }])}
        >
          {t('add')}
        </button>
      )}
    </div>
  );
}
