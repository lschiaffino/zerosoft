'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { defaultStep, STEP_TYPES, type RobotLeafStep, type RobotStep, type RobotStepType } from '@/lib/robots-schema';

type AnyStep = RobotStep | RobotLeafStep;

interface ListProps<S extends AnyStep> {
  steps: S[];
  onChange: (steps: S[]) => void;
  readOnly: boolean;
  /** Dentro de un loop no se ofrecen loops. */
  nested?: boolean;
  /** Prefijo de numeración ("3." dentro del loop del paso 3). */
  prefix?: string;
  invalidIndex?: number | null;
}

/** Lista editable de pasos: agregar, reordenar, borrar y configurar. */
export default function StepList<S extends AnyStep>({ steps, onChange, readOnly, nested, prefix = '', invalidIndex }: ListProps<S>) {
  const t = useTranslations('robots.steps');
  const [newType, setNewType] = useState<RobotStepType>(nested ? 'extract' : 'goto');
  const types = STEP_TYPES.filter((x) => !nested || x !== 'loop_over');

  function update(i: number, next: S) {
    onChange(steps.map((s, k) => (k === i ? next : s)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const copy = [...steps];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  }
  function remove(i: number) {
    onChange(steps.filter((_, k) => k !== i));
  }
  function add() {
    onChange([...steps, defaultStep(newType) as S]);
  }

  return (
    <div className={`robots-steps${nested ? ' is-nested' : ''}`}>
      {steps.length === 0 && !nested && <p className="muted robots-steps-empty">{t('empty')}</p>}
      <ol className="robots-step-list">
        {steps.map((s, i) => (
          <li key={i} className={`robots-step${invalidIndex === i ? ' is-invalid' : ''}`}>
            <div className="robots-step-head">
              <span className="robots-step-num">{`${prefix}${i + 1}`}</span>
              <span className="robots-step-type">{t(`types.${s.type}`)}</span>
              {!readOnly && (
                <span className="robots-step-actions">
                  <button type="button" className="robots-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('moveUp')} title={t('moveUp')}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="robots-icon-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === steps.length - 1}
                    aria-label={t('moveDown')}
                    title={t('moveDown')}
                  >
                    ↓
                  </button>
                  <button type="button" className="robots-icon-btn" onClick={() => remove(i)} aria-label={t('remove')} title={t('remove')}>
                    ×
                  </button>
                </span>
              )}
            </div>
            <StepFields step={s} readOnly={readOnly} onChange={(next) => update(i, next as S)} prefix={`${prefix}${i + 1}.`} />
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div className="robots-step-add">
          <select className="select" value={newType} onChange={(e) => setNewType(e.target.value as RobotStepType)} aria-label={t('add')}>
            {types.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-small" onClick={add}>
            {nested ? t('addInLoop') : t('add')}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`robots-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function StepFields({
  step,
  onChange,
  readOnly,
  prefix,
}: {
  step: AnyStep;
  onChange: (s: AnyStep) => void;
  readOnly: boolean;
  prefix: string;
}) {
  const t = useTranslations('robots.steps');
  const set = (patch: Record<string, unknown>) => onChange({ ...step, ...patch } as AnyStep);
  const text = (key: string, label: string, placeholder = '', wide = false) => (
    <Field label={label} wide={wide}>
      <input
        className="input mono"
        value={String((step as Record<string, unknown>)[key] ?? '')}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  const num = (key: string, label: string, min: number, max: number) => (
    <Field label={label}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={Number((step as Record<string, unknown>)[key] ?? 0)}
        readOnly={readOnly}
        onChange={(e) => set({ [key]: Math.min(max, Math.max(min, Math.floor(Number(e.target.value) || 0))) })}
      />
    </Field>
  );

  switch (step.type) {
    case 'goto':
      return <div className="robots-fields">{text('url', t('fields.url'), 'https://example.com/{{inputs.page}}', true)}</div>;
    case 'click':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'button[type="submit"]')}
          {text('text', t('fields.text'), 'Sign in')}
        </div>
      );
    case 'fill':
    case 'select':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'input[name="email"]')}
          {text('value', t('fields.value'), '{{inputs.email}}')}
        </div>
      );
    case 'press':
      return (
        <div className="robots-fields">
          {text('key', t('fields.key'), 'Enter')}
          {text('selector', t('fields.selector'), 'input[type="search"]')}
        </div>
      );
    case 'wait':
      return (
        <div className="robots-fields">
          {num('ms', t('fields.ms'), 0, 30_000)}
          {text('selector', t('fields.waitSelector'), '.results')}
        </div>
      );
    case 'extract':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), '.price')}
          {text('name', t('fields.name'), 'price')}
          <Field label={t('fields.mode')}>
            <select className="select" value={step.mode} disabled={readOnly} onChange={(e) => set({ mode: e.target.value })}>
              {(['text', 'attribute', 'all'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`modes.${m}`)}
                </option>
              ))}
            </select>
          </Field>
          {(step.mode === 'attribute' || step.mode === 'all') && text('attribute', t('fields.attribute'), 'href')}
        </div>
      );
    case 'extract_table':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'table')}
          {text('name', t('fields.name'), 'rows')}
        </div>
      );
    case 'screenshot':
      return <div className="robots-fields">{text('name', t('fields.shotName'), 'page')}</div>;
    case 'scroll':
      return (
        <div className="robots-fields">
          {num('y', t('fields.y'), 0, 100_000)}
          {text('selector', t('fields.scrollSelector'), 'footer')}
        </div>
      );
    case 'if_exists':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), '.cookie-banner button')}
          {text('text', t('fields.text'), 'Accept')}
          <Field label={t('fields.onMissing')}>
            <select className="select" value={step.onMissing} disabled={readOnly} onChange={(e) => set({ onMissing: e.target.value })}>
              {(['skip', 'goto', 'stop', 'fail'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`onMissing.${m}`)}
                </option>
              ))}
            </select>
          </Field>
          {step.onMissing === 'skip' && num('count', t('fields.count'), 1, 100)}
          {step.onMissing === 'goto' && num('target', t('fields.target'), 1, 100)}
        </div>
      );
    case 'loop_over':
      return (
        <div className="robots-fields">
          {text('list', t('fields.list'), '{{inputs.urls}}')}
          {num('max', t('fields.max'), 1, 50)}
          <div className="robots-loop">
            <StepList
              steps={step.steps}
              nested
              readOnly={readOnly}
              prefix={prefix}
              onChange={(steps) => set({ steps })}
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}
