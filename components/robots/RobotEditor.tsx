'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import type { RobotDto, RobotRunDto, RobotUsage } from '@/lib/robots';
import { isValidCron, nextCronRuns } from '@/lib/cron';
import { parseRecordedSteps, PASSWORD_PLACEHOLDER } from '@/lib/robots-recorder';
import {
  deriveInputName,
  nameFollowsLabel,
  presetUsesTime,
  SCHEDULE_PRESETS,
  scheduleFromPreset,
  schedulePreset,
  scheduleTime,
  stableJson,
  type SchedulePreset,
} from '@/lib/robots-editor';
import {
  countSteps,
  MAX_ROBOT_STEPS,
  MAX_TIMEOUT_SEC,
  MIN_SCHEDULE_MINUTES,
  type RobotInputDef,
  type RobotSchedule,
  type RobotStep,
} from '@/lib/robots-schema';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import StepList from './StepList';
import RunsPanel from './RunsPanel';
import { errorText, RobotDialog, RunnerNote, UsageMeter } from './robots-ui';
import { useStableKeys } from './useStableKeys';

const TABS = ['steps', 'inputs', 'schedule', 'runs', 'advanced'] as const;
type Tab = (typeof TABS)[number];

/** ?tab= de la URL; "settings" era la pestaña vieja de ajustes. */
function tabFromParam(v: string | null): Tab {
  if (v === 'settings') return 'schedule';
  return (TABS as readonly string[]).includes(v ?? '') ? (v as Tab) : 'steps';
}

interface Props {
  robot: RobotDto;
  runs: RobotRunDto[];
  usage: RobotUsage;
  canEdit: boolean;
}

/** Editor de un robot: pasos, entradas, programación, corridas y avanzado. Un solo Guardar. */
export default function RobotEditor({ robot: initial, runs: initialRuns, usage: initialUsage, canEdit }: Props) {
  const t = useTranslations('robots');
  const router = useRouter();
  const params = useSearchParams();
  const uid = useId();
  const [robot, setRobot] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [steps, setSteps] = useState<RobotStep[]>(initial.steps);
  const [inputs, setInputs] = useState<RobotInputDef[]>(initial.inputs);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [schedule, setSchedule] = useState<RobotSchedule>(initial.schedule);
  const [timeoutSec, setTimeoutSec] = useState(initial.timeoutSec);
  const [persistSession, setPersistSession] = useState(initial.persistSession);
  const [hasSession, setHasSession] = useState(initial.hasSession);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMode, setPasteMode] = useState<'append' | 'replace'>('append');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [runs, setRuns] = useState(initialRuns);
  const [usage, setUsage] = useState(initialUsage);
  const [selectedRun, setSelectedRun] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [tab, setTabState] = useState<Tab>(() => tabFromParam(params.get('tab')));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidIndex, setInvalidIndex] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [runValues, setRunValues] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const readOnly = !canEdit;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const payload = useMemo(
    () => ({ name, description, steps, inputs, enabled, schedule, timeoutSec, persistSession }),
    [name, description, steps, inputs, enabled, schedule, timeoutSec, persistSession],
  );
  const dirty =
    stableJson(payload) !==
    stableJson({
      name: robot.name,
      description: robot.description,
      steps: robot.steps,
      inputs: robot.inputs,
      enabled: robot.enabled,
      schedule: robot.schedule,
      timeoutSec: robot.timeoutSec,
      persistSession: robot.persistSession,
    });

  /** Cambia de pestaña y la deja en la URL (?tab=) sin recargar la página. */
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'steps') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // Sin history (vista previa): la pestaña igual cambia.
    }
  }, []);

  // En el teléfono la barra de pestañas se desplaza: la activa siempre a la vista.
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab]);

  // Avisa antes de cerrar la pestaña con cambios sin guardar (como el editor de Flow).
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      else if (data?.error === 'invalid_inputs' || data?.error === 'duplicate_input') setTab('inputs');
      setError(errorText(t, data?.error, { index: (idx ?? 0) + 1 }));
      return false;
    }
    // Lo guardado (normalizado por la API) pasa a ser el estado del editor.
    setRobot(data.robot);
    setName(data.robot.name);
    setDescription(data.robot.description);
    setSteps(data.robot.steps);
    setInputs(data.robot.inputs);
    setEnabled(data.robot.enabled);
    setSchedule(data.robot.schedule);
    setTimeoutSec(data.robot.timeoutSec);
    setPersistSession(data.robot.persistSession);
    setHasSession(data.robot.hasSession);
    setSavedAt(Date.now());
    return true;
  }

  // ⌘S / Ctrl+S guarda.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving) void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, saving]);

  function startRun() {
    // Sin entradas no hay nada que preguntar: corre directo.
    if (inputs.length === 0) {
      void run({});
      return;
    }
    const values: Record<string, string> = {};
    for (const d of inputs) values[d.name] = d.default ?? '';
    setRunValues(values);
    setRunOpen(true);
  }

  async function run(values: Record<string, string>) {
    if (dirty && !(await save())) {
      setRunOpen(false);
      return;
    }
    setRunning(true);
    setError(null);
    setTab('runs');
    const res = await fetch(`/api/robots/${robot.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: values }),
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
    const u = await fetch('/api/robots')
      .then((r) => r.json() as Promise<{ usage?: RobotUsage }>)
      .catch(() => null);
    if (u?.usage) setUsage(u.usage);
  }

  function importPasted() {
    const res = parseRecordedSteps(pasteText);
    if (!res.ok) {
      setPasteError(t(`paste.errors.${res.error}`, { index: (res.index ?? 0) + 1 }));
      return;
    }
    const next = pasteMode === 'replace' ? res.steps : [...steps, ...res.steps];
    if (countSteps(next) > MAX_ROBOT_STEPS) {
      setPasteError(t('errors.too_many_steps'));
      return;
    }
    setSteps(next);
    setPasteOpen(false);
    setPasteText('');
    setPasteError(null);
    setToast(t('paste.imported', { count: res.steps.length }));
  }

  async function clearSession() {
    const res = await fetch(`/api/robots/${robot.id}/session`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setHasSession(false);
    setToast(t('settings.sessionCleared'));
  }

  async function remove() {
    setDeleting(true);
    const res = await fetch(`/api/robots/${robot.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setDeleting(false);
      setDeleteOpen(false);
      setError(t('errors.generic'));
      return;
    }
    router.push('/app/robots');
  }

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    let next: Tab | null = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const stepCount = countSteps(steps);
  const noRunner = usage.backend === 'none';
  const saveState = saving ? t('editor.saving') : dirty ? t('editor.unsaved') : savedAt ? t('editor.saved') : '';
  const runButton = canEdit ? (
    <button
      type="button"
      className="btn btn-primary"
      onClick={startRun}
      disabled={running || noRunner || stepCount === 0}
      aria-busy={running || undefined}
      title={noRunner ? t('runner.none') : stepCount === 0 ? t('errors.no_steps') : undefined}
    >
      {running ? t('editor.running') : t('editor.run')}
    </button>
  ) : null;

  return (
    <div className="app-page ui-page robots-editor">
      <PageHeader
        back={{ href: '/app/robots', label: t('editor.back') }}
        title={
          <input
            className="robots-title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={readOnly}
            aria-label={t('editor.namePlaceholder')}
            placeholder={t('editor.namePlaceholder')}
            maxLength={120}
            size={Math.max(12, Math.min(48, name.length + 1))}
          />
        }
        description={
          <input
            className="robots-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={readOnly}
            aria-label={t('editor.descriptionLabel')}
            placeholder={readOnly ? '' : t('editor.descriptionPlaceholder')}
            maxLength={1000}
          />
        }
        actions={
          canEdit ? (
            <>
              <span className="robots-save-state" aria-live="polite" data-dirty={dirty || undefined}>
                {saveState}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void save()}
                disabled={!dirty || saving}
                aria-busy={saving || undefined}
                aria-keyshortcuts="Meta+S Control+S"
              >
                {t('editor.save')}
              </button>
              {runButton}
            </>
          ) : undefined
        }
      />

      {readOnly && <p className="robots-muted">{t('editor.readOnly')}</p>}
      {noRunner && canEdit && <RunnerNote backend="none" />}
      {error && (
        <p className="robots-alert" role="alert">
          {error}
        </p>
      )}

      <div className="ui-tabs" role="tablist" aria-label={t('editor.sections')} onKeyDown={onTabKey}>
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            id={`${uid}-tab-${k}`}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={tab === k}
            aria-controls={`${uid}-panel`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
          >
            {t(`editor.tabs.${k}`)}
            {k === 'steps' && <span className="ui-tab-count">{stepCount}</span>}
            {k === 'inputs' && inputs.length > 0 && <span className="ui-tab-count">{inputs.length}</span>}
            {k === 'runs' && runs.length > 0 && <span className="ui-tab-count">{runs.length}</span>}
          </button>
        ))}
      </div>

      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="robots-panel">
        {tab === 'steps' && (
          <div className="robots-steps-layout">
            <div className="robots-steps-main">
              <div className="robots-toolbar">
                <p className="robots-muted">{t('steps.count', { count: stepCount, max: MAX_ROBOT_STEPS })}</p>
                <span className="robots-toolbar-actions">
                  <Link href="/app/robots/recorder" className="btn btn-ghost btn-sm">
                    {t('editor.record')}
                  </Link>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setPasteError(null);
                        setPasteOpen(true);
                      }}
                    >
                      {t('editor.paste')}
                    </button>
                  )}
                </span>
              </div>
              {steps.length === 0 && (
                <EmptyState
                  quiet
                  title={t('steps.emptyTitle')}
                  body={t('steps.empty')}
                  secondary={
                    <>
                      {t('steps.emptyAlt')} <Link href="/app/robots/recorder">{t('steps.emptyAltLink')}</Link>
                    </>
                  }
                />
              )}
              <StepList steps={steps} onChange={setSteps} readOnly={readOnly} invalidIndex={invalidIndex} />
            </div>
            <aside className="robots-aside" aria-labelledby={`${uid}-tips`}>
              <h2 className="robots-h3" id={`${uid}-tips`}>
                {t('steps.tipsTitle')}
              </h2>
              <ul>
                {(t.raw('steps.tips') as string[]).map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
              <p>
                {t('steps.templateHint', { inputs: '{{inputs.x}}', vars: '{{vars.x}}', loopItem: '{{loop.item}}' })}
              </p>
              <div className="robots-aside-cred">
                <h2 className="robots-h3">{t('steps.credentialsTitle')}</h2>
                <p>{t('steps.credentialsTip', { example: '{{credentials.name.password}}' })}</p>
                <Link href="/app/flow/credentials" className="robots-link">
                  {t('steps.credentialsLink')}
                </Link>
              </div>
            </aside>
          </div>
        )}

        {tab === 'inputs' && <InputsEditor inputs={inputs} onChange={setInputs} readOnly={readOnly} />}

        {tab === 'schedule' && (
          <ScheduleEditor
            schedule={schedule}
            onChange={setSchedule}
            enabled={enabled}
            onEnabled={setEnabled}
            readOnly={readOnly}
            nextRunAt={robot.enabled && robot.schedule && !dirty ? robot.nextRunAt : null}
          />
        )}

        {tab === 'runs' && (
          <RunsPanel runs={runs} selectedId={selectedRun} onSelect={setSelectedRun} running={running} emptyAction={runButton} />
        )}

        {tab === 'advanced' && (
          <div className="robots-advanced">
            <FormSection title={t('settings.sessionTitle')} description={t('settings.sessionHint')}>
              <label className="ui-switch">
                <input type="checkbox" role="switch" checked={persistSession} disabled={readOnly} onChange={(e) => setPersistSession(e.target.checked)} />
                <span>{t('settings.session')}</span>
              </label>
              <div className="robots-inline">
                <span className="robots-muted">{hasSession ? t('settings.sessionSaved') : t('settings.sessionEmpty')}</span>
                {!readOnly && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!hasSession} onClick={() => void clearSession()}>
                    {t('settings.clearSession')}
                  </button>
                )}
              </div>
            </FormSection>

            <FormSection title={t('settings.timeoutTitle')} description={t('settings.timeoutHint', { max: MAX_TIMEOUT_SEC })}>
              <div className="ui-field robots-narrow">
                <label className="label" htmlFor={`${uid}-timeout`}>
                  {t('settings.timeout')}
                </label>
                <input
                  id={`${uid}-timeout`}
                  className="input"
                  type="number"
                  min={10}
                  max={MAX_TIMEOUT_SEC}
                  value={timeoutSec}
                  readOnly={readOnly}
                  onChange={(e) => setTimeoutSec(Math.min(MAX_TIMEOUT_SEC, Math.max(10, Math.floor(Number(e.target.value) || 10))))}
                />
              </div>
            </FormSection>

            <FormSection title={t('settings.credentialsTitle')} description={t('settings.credentialsDesc')}>
              <div className="robots-inline">
                <Link href="/app/flow/credentials" className="btn btn-secondary btn-sm">
                  {t('settings.credentialsOpen')}
                </Link>
                <Link href="/app/settings" className="robots-link">
                  {t('settings.globalSettings')}
                </Link>
              </div>
            </FormSection>

            <FormSection title={t('settings.flowTitle')} description={t('settings.flowHint')}>
              <CopyId id={robot.id} />
            </FormSection>

            <FormSection title={t('settings.usageTitle')}>
              <UsageMeter usage={usage} />
              <RunnerNote backend={usage.backend} />
              <p className="robots-muted robots-small">{t('settings.responsible')}</p>
            </FormSection>

            {canEdit && (
              <FormSection
                tone="danger"
                title={t('editor.deleteTitle')}
                description={t('editor.deleteDesc')}
                footer={
                  <button type="button" className="btn btn-primary btn-danger" onClick={() => setDeleteOpen(true)}>
                    {t('editor.delete')}
                  </button>
                }
              />
            )}
          </div>
        )}
      </div>

      <RobotDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title={t('paste.title')}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen(false)}>
              {t('paste.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={importPasted} disabled={!pasteText.trim()}>
              {t('paste.import')}
            </button>
          </>
        }
      >
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-paste`}>
            {t('paste.desc')}
          </label>
          <textarea
            id={`${uid}-paste`}
            className="textarea data"
            rows={10}
            value={pasteText}
            autoFocus
            spellCheck={false}
            aria-invalid={pasteError ? true : undefined}
            placeholder='{"zerosoftRobotSteps": 1, "steps": [...]}'
            onChange={(e) => setPasteText(e.target.value)}
          />
          {pasteError && (
            <p className="ui-error" role="alert">
              {pasteError}
            </p>
          )}
        </div>
        <fieldset className="robots-radios">
          <legend className="label">{t('paste.modeLabel')}</legend>
          {(['append', 'replace'] as const).map((m) => (
            <label key={m} className="robots-radio">
              <input type="radio" name="paste-mode" checked={pasteMode === m} onChange={() => setPasteMode(m)} />
              <span>{t(`paste.${m}`)}</span>
            </label>
          ))}
        </fieldset>
        <p className="ui-help">{t('paste.passwordNote', { placeholder: PASSWORD_PLACEHOLDER })}</p>
      </RobotDialog>

      <RobotDialog
        open={runOpen}
        busy={running}
        onClose={() => setRunOpen(false)}
        title={t('run.title', { name })}
        foot={
          <>
            <span className="ui-foot-note">{t('run.desc', { seconds: timeoutSec })}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setRunOpen(false)} disabled={running}>
              {t('run.cancel')}
            </button>
            <button type="submit" form={`${uid}-run`} className="btn btn-primary" disabled={running} aria-busy={running || undefined}>
              {running ? t('editor.running') : t('run.start')}
            </button>
          </>
        }
      >
        <form
          id={`${uid}-run`}
          className="ui-fields"
          onSubmit={(e) => {
            e.preventDefault();
            void run(runValues);
          }}
        >
          {inputs.map((d, i) => (
            <div key={d.name} className="ui-field">
              <label className="label" htmlFor={`${uid}-in-${d.name}`}>
                {d.label || d.name}
                {!d.required && <span className="ui-optional"> {t('run.optional')}</span>}
              </label>
              {d.kind === 'list' ? (
                <textarea
                  id={`${uid}-in-${d.name}`}
                  className="textarea data"
                  rows={4}
                  required={d.required}
                  autoFocus={i === 0}
                  value={runValues[d.name] ?? ''}
                  onChange={(e) => setRunValues({ ...runValues, [d.name]: e.target.value })}
                />
              ) : (
                <input
                  id={`${uid}-in-${d.name}`}
                  className="input"
                  required={d.required}
                  autoFocus={i === 0}
                  value={runValues[d.name] ?? ''}
                  onChange={(e) => setRunValues({ ...runValues, [d.name]: e.target.value })}
                />
              )}
              {d.kind === 'list' && <p className="ui-help">{t('inputs.kinds.list')}</p>}
            </div>
          ))}
        </form>
      </RobotDialog>

      <RobotDialog
        open={deleteOpen}
        busy={deleting}
        onClose={() => setDeleteOpen(false)}
        title={t('editor.deleteDialogTitle', { name: name || t('editor.untitled') })}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t('editor.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-danger"
              onClick={() => void remove()}
              disabled={deleting}
              aria-busy={deleting || undefined}
            >
              {t('editor.delete')}
            </button>
          </>
        }
      >
        <p>{t('editor.deleteDesc')}</p>
      </RobotDialog>

      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && <div className="ui-toast">{toast}</div>}
      </div>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const t = useTranslations('robots.settings');
  const [copied, setCopied] = useState(false);
  return (
    <div className="robots-inline">
      <code className="robots-id data">{id}</code>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(id).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t('copied') : t('copyId')}
      </button>
    </div>
  );
}

/** Zonas horarias del navegador (se cargan después de montar para no romper la hidratación). */
function useTimezones(current: string): string[] {
  const [zones, setZones] = useState<string[]>([current]);
  useEffect(() => {
    let list: string[] = [];
    try {
      list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      list = [];
    }
    if (!list.includes('UTC')) list = ['UTC', ...list];
    setZones(list.includes(current) ? list : [current, ...list]);
  }, [current]);
  return zones;
}

/** Programación: presets (Manual, cada hora, diario, días hábiles, semanal) y uno personalizado. */
function ScheduleEditor({
  schedule,
  onChange,
  enabled,
  onEnabled,
  readOnly,
  nextRunAt,
}: {
  schedule: RobotSchedule;
  onChange: (s: RobotSchedule) => void;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  readOnly: boolean;
  nextRunAt: string | null;
}) {
  const t = useTranslations('robots.settings');
  const format = useFormatter();
  const id = useId();
  const preset = schedulePreset(schedule);
  // "Personalizado" elegido a mano se mantiene aunque el valor coincida con un preset.
  const [customPicked, setCustomPicked] = useState(false);
  const shown: SchedulePreset = customPicked && schedule ? 'custom' : preset;
  const time = scheduleTime(schedule);
  const localTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const timezone = schedule?.timezone ?? 'UTC';
  const zones = useTimezones(timezone);
  const usesTz = schedule !== null && (presetUsesTime(shown) || (shown === 'custom' && schedule.mode !== 'interval'));

  function pick(p: SchedulePreset) {
    setCustomPicked(p === 'custom');
    onChange(scheduleFromPreset(p, schedule, { timezone: schedule?.timezone ?? localTz }));
  }

  return (
    <div className="robots-schedule">
      <FormSection title={t('scheduleTitle')} description={t('scheduleDesc')}>
        <fieldset className="robots-presets" disabled={readOnly}>
          <legend className="label">{t('presetLabel')}</legend>
          {SCHEDULE_PRESETS.map((p) => (
            <label key={p} className="robots-preset">
              <input type="radio" name={`${id}-preset`} checked={shown === p} onChange={() => pick(p)} />
              <span className="robots-preset-text">
                <span className="robots-preset-name">{t(`presets.${p}`)}</span>
                <span className="robots-preset-hint">{t(p === 'none' && !enabled ? 'presets.noneHintOff' : `presets.${p}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {schedule && (presetUsesTime(shown) || usesTz) && (
          <div className="ui-fields-2">
            {presetUsesTime(shown) && (
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-time`}>
                  {t('time')}
                </label>
                <input
                  id={`${id}-time`}
                  className="input"
                  type="time"
                  value={time}
                  readOnly={readOnly}
                  onChange={(e) => e.target.value && onChange(scheduleFromPreset(shown, schedule, { time: e.target.value }))}
                />
              </div>
            )}
            {usesTz && (
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-tz`}>
                  {t('timezone')}
                </label>
                <select
                  id={`${id}-tz`}
                  className="select"
                  value={timezone}
                  disabled={readOnly}
                  onChange={(e) => onChange({ ...schedule, timezone: e.target.value })}
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {schedule && shown === 'custom' && (
          <CustomSchedule schedule={schedule} onChange={onChange} readOnly={readOnly} />
        )}

        {schedule && (
          <div className="robots-schedule-foot">
            {nextRunAt && (
              <p suppressHydrationWarning>
                {t('nextRun', { date: format.dateTime(new Date(nextRunAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
              </p>
            )}
            <p className="robots-muted robots-small">{t('granularity')}</p>
          </div>
        )}
      </FormSection>

      <FormSection title={t('automaticTitle')} description={t('enabledHint')}>
        <label className="ui-switch">
          <input type="checkbox" role="switch" checked={enabled} disabled={readOnly} onChange={(e) => onEnabled(e.target.checked)} />
          <span>{t('enabled')}</span>
        </label>
        {schedule && !enabled && (
          <div className="robots-note-warn robots-note-action">
            <p>{t('scheduleOff')}</p>
            {!readOnly && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEnabled(true)}>
                {t('turnOn')}
              </button>
            )}
          </div>
        )}
      </FormSection>
    </div>
  );
}

function CustomSchedule({ schedule, onChange, readOnly }: { schedule: NonNullable<RobotSchedule>; onChange: (s: RobotSchedule) => void; readOnly: boolean }) {
  const t = useTranslations('robots.settings');
  const id = useId();
  const mode = schedule.mode === 'interval' ? 'interval' : 'cron';
  const max = schedule.unit === 'minutes' ? 1440 : 168;
  const cronBad = mode === 'cron' && !isValidCron(schedule.cron ?? '');
  const minBad = mode === 'interval' && schedule.unit === 'minutes' && schedule.every < MIN_SCHEDULE_MINUTES;

  return (
    <div className="robots-custom">
      <div className="btn-group" role="group" aria-label={t('customMode')}>
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={mode === 'interval'}
          disabled={readOnly}
          onClick={() => onChange({ ...schedule, mode: 'interval', every: schedule.every === 1 ? 30 : schedule.every, unit: schedule.every === 1 ? 'minutes' : schedule.unit })}
        >
          {t('scheduleInterval')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={mode === 'cron'}
          disabled={readOnly}
          onClick={() => onChange({ ...schedule, mode: 'cron', cron: schedule.cron || '0 9 * * 1-5' })}
        >
          {t('scheduleCron')}
        </button>
      </div>

      {mode === 'interval' ? (
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-every`}>
              {t('everyN')}
            </label>
            <input
              id={`${id}-every`}
              className="input"
              type="number"
              min={schedule.unit === 'minutes' ? MIN_SCHEDULE_MINUTES : 1}
              max={max}
              value={schedule.every}
              readOnly={readOnly}
              aria-invalid={minBad || undefined}
              aria-describedby={`${id}-every-help`}
              onChange={(e) => onChange({ ...schedule, every: Math.min(max, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
            />
            <p id={`${id}-every-help`} className={minBad ? 'ui-error' : 'ui-help'}>
              {t('minMinutes')}
            </p>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-unit`}>
              {t('unit')}
            </label>
            <select
              id={`${id}-unit`}
              className="select"
              disabled={readOnly}
              value={schedule.unit ?? 'hours'}
              onChange={(e) => {
                const unit = e.target.value as 'hours' | 'minutes';
                const every = unit === 'minutes' ? Math.max(MIN_SCHEDULE_MINUTES, schedule.every) : Math.min(168, schedule.every);
                onChange({ ...schedule, unit, every });
              }}
            >
              <option value="hours">{t('units.hours')}</option>
              <option value="minutes">{t('units.minutes')}</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-cron`}>
            {t('cron')}
          </label>
          <input
            id={`${id}-cron`}
            className="input data robots-cron"
            value={schedule.cron ?? ''}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            placeholder="0 9 * * 1-5"
            aria-invalid={cronBad || undefined}
            aria-describedby={`${id}-cron-help`}
            onChange={(e) => onChange({ ...schedule, cron: e.target.value })}
          />
          <div id={`${id}-cron-help`}>
            <CronPreview cron={schedule.cron ?? ''} timezone={schedule.timezone} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Vista previa de las próximas corridas de un cron (o aviso si es inválido). */
function CronPreview({ cron, timezone }: { cron: string; timezone: string }) {
  const t = useTranslations('robots.settings');
  const format = useFormatter();
  if (!isValidCron(cron)) return <p className="ui-error">{t('cronInvalid')}</p>;
  const runs = nextCronRuns(cron, timezone || 'UTC', 3);
  return (
    <>
      <p className="ui-help">{t('cronHint')}</p>
      {runs.length > 0 && (
        <p className="ui-help" suppressHydrationWarning>
          {t('cronPreview')}: {runs.map((d) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })).join(' · ')}
        </p>
      )}
    </>
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
  const uid = useId();
  const [focusLast, setFocusLast] = useState(false);
  const stable = useStableKeys(inputs.length);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!focusLast) return;
    tableRef.current?.querySelector<HTMLInputElement>('tr:last-child input')?.focus();
    setFocusLast(false);
  }, [focusLast]);

  const set = (i: number, patch: Partial<RobotInputDef>) => onChange(inputs.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const setLabel = (i: number, label: string) => {
    const d = inputs[i];
    // El nombre técnico sigue a la etiqueta hasta que alguien lo edita a mano.
    const follow = nameFollowsLabel(d.name, d.label);
    const derived = deriveInputName(label);
    set(i, follow && derived ? { label, name: derived } : { label });
  };
  const add = () => {
    onChange([...inputs, { name: `input${inputs.length + 1}`, label: '', kind: 'text', default: '', required: false }]);
    setFocusLast(true);
  };

  const addButton = !readOnly ? (
    <button type="button" className="btn btn-secondary btn-sm" onClick={add}>
      {t('add')}
    </button>
  ) : null;

  return (
    <div className="robots-inputs">
      <p className="robots-lead">{t('desc', { example: '{{inputs.name}}' })}</p>
      {inputs.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          body={t('empty')}
          action={
            !readOnly ? (
              <button type="button" className="btn btn-primary" onClick={add}>
                {t('add')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table robots-input-table">
              <caption className="sr-only">{t('title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('label')}</th>
                  <th scope="col">{t('name')}</th>
                  <th scope="col">{t('kind')}</th>
                  <th scope="col">{t('default')}</th>
                  <th scope="col">{t('required')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('remove')}</span>
                  </th>
                </tr>
              </thead>
              <tbody ref={tableRef}>
                {inputs.map((d, i) => (
                  <tr key={stable.keys[i]}>
                    <td data-label={t('label')}>
                      <input
                        className="input"
                        value={d.label}
                        readOnly={readOnly}
                        placeholder={t('labelPlaceholder')}
                        aria-label={`${t('label')} ${i + 1}`}
                        onChange={(e) => setLabel(i, e.target.value)}
                      />
                    </td>
                    <td data-label={t('name')}>
                      <input
                        className="input data"
                        value={d.name}
                        readOnly={readOnly}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={`${t('name')} ${i + 1}`}
                        aria-describedby={`${uid}-namehelp`}
                        onChange={(e) => set(i, { name: e.target.value })}
                      />
                    </td>
                    <td data-label={t('kind')}>
                      <select className="select" value={d.kind} disabled={readOnly} aria-label={`${t('kind')} ${i + 1}`} onChange={(e) => set(i, { kind: e.target.value as 'text' | 'list' })}>
                        <option value="text">{t('kinds.text')}</option>
                        <option value="list">{t('kinds.list')}</option>
                      </select>
                    </td>
                    <td data-label={t('default')}>
                      {d.kind === 'list' ? (
                        <textarea className="textarea data" rows={2} value={d.default} readOnly={readOnly} aria-label={`${t('default')} ${i + 1}`} onChange={(e) => set(i, { default: e.target.value })} />
                      ) : (
                        <input className="input" value={d.default} readOnly={readOnly} aria-label={`${t('default')} ${i + 1}`} onChange={(e) => set(i, { default: e.target.value })} />
                      )}
                    </td>
                    <td data-label={t('required')} className="robots-input-required">
                      <label className="ui-check">
                        <input type="checkbox" checked={d.required} disabled={readOnly} onChange={(e) => set(i, { required: e.target.checked })} />
                        <span className="sr-only">{`${t('required')} ${i + 1}`}</span>
                      </label>
                    </td>
                    <td className="robots-input-remove">
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          aria-label={`${t('remove')} ${d.label || d.name}`}
                          title={t('remove')}
                          onClick={() => {
                            stable.remove(i);
                            onChange(inputs.filter((_, k) => k !== i));
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-help" id={`${uid}-namehelp`}>
            {t('nameHint')}
          </p>
          {addButton}
        </>
      )}
      <p className="robots-note-warn" role="note">
        {t('passwordWarning')}
      </p>
    </div>
  );
}
