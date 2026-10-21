'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useStableKeys } from './useStableKeys';
import {
  defaultStep,
  MAX_LIST_FIELDS,
  MAX_PAGINATE_PAGES,
  STEP_TYPES,
  type RobotLeafStep,
  type RobotListField,
  type RobotStep,
  type RobotStepType,
} from '@/lib/robots-schema';

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

/**
 * Lista editable de pasos, numerada y separada por filetes. Reordenar, reintentos y quitar viven en el menú "⋯" de cada paso.
 */
export default function StepList<S extends AnyStep>({ steps, onChange, readOnly, nested, prefix = '', invalidIndex }: ListProps<S>) {
  const t = useTranslations('robots.steps');
  const [newType, setNewType] = useState<RobotStepType>(nested ? 'extract' : 'goto');
  const types = STEP_TYPES.filter((x) => !nested || x !== 'loop_over');
  const listRef = useRef<HTMLOListElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const stable = useStableKeys(steps.length);

  // Después de agregar o mover, el foco va al paso (no se pierde en el body).
  useEffect(() => {
    if (focusIndex === null) return;
    const li = listRef.current?.children[focusIndex] as HTMLElement | undefined;
    const target = li?.querySelector<HTMLElement>('input, select, textarea') ?? li?.querySelector<HTMLElement>('button');
    target?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  function update(i: number, next: S) {
    onChange(steps.map((s, k) => (k === i ? next : s)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const copy = [...steps];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    stable.swap(i, j);
    onChange(copy);
  }
  function remove(i: number) {
    stable.remove(i);
    onChange(steps.filter((_, k) => k !== i));
  }
  function add() {
    onChange([...steps, defaultStep(newType) as S]);
    setFocusIndex(steps.length);
  }

  return (
    <div className={`robots-steps${nested ? ' is-nested' : ''}`}>
      {steps.length > 0 && (
        <ol className="robots-steplist" ref={listRef}>
          {steps.map((s, i) => (
            <StepItem
              key={stable.keys[i]}
              step={s}
              num={`${prefix}${i + 1}`}
              invalid={invalidIndex === i}
              readOnly={readOnly}
              first={i === 0}
              last={i === steps.length - 1}
              onChange={(next) => update(i, next as S)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => remove(i)}
            />
          ))}
        </ol>
      )}
      {!readOnly && (
        <div className="robots-add">
          <select className="select" value={newType} onChange={(e) => setNewType(e.target.value as RobotStepType)} aria-label={t('addType')}>
            {types.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={add}>
            {nested ? t('addInLoop') : t('add')}
          </button>
        </div>
      )}
    </div>
  );
}

function StepItem({
  step,
  num,
  invalid,
  readOnly,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  step: AnyStep;
  num: string;
  invalid: boolean;
  readOnly: boolean;
  first: boolean;
  last: boolean;
  onChange: (s: AnyStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('robots.steps');
  const rec = step as Record<string, unknown>;
  const retries = Number(rec.retries ?? 0);
  const canRetry = step.type !== 'loop_over';
  // if_exists ya decide qué pasa si falta el elemento; el loop tiene su propia opción por elemento.
  const canContinue = step.type !== 'loop_over' && step.type !== 'if_exists';
  const continues = rec.continueOnError === true;
  const [retryOpen, setRetryOpen] = useState(false);
  const retryRef = useRef<HTMLInputElement>(null);
  const showRetry = canRetry && (retries > 0 || retryOpen);
  const titleId = useId();

  useEffect(() => {
    if (retryOpen) retryRef.current?.focus();
  }, [retryOpen]);

  const setNum = (key: 'retries' | 'retryDelayMs', raw: string, max: number) => {
    const n = Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)));
    const next = { ...rec } as Record<string, unknown>;
    if (n === 0) delete next[key];
    else next[key] = n;
    onChange(next as AnyStep);
  };
  const clearRetries = () => {
    const next = { ...rec } as Record<string, unknown>;
    delete next.retries;
    delete next.retryDelayMs;
    onChange(next as AnyStep);
    setRetryOpen(false);
  };

  const menu: MenuItem[] = [
    { key: 'up', label: t('moveUp'), disabled: first, run: () => onMove(-1) },
    { key: 'down', label: t('moveDown'), disabled: last, run: () => onMove(1) },
  ];
  if (canRetry) {
    menu.push(
      showRetry
        ? { key: 'retry', label: t('retriesRemove'), run: clearRetries }
        : {
            key: 'retry',
            label: t('retriesAdd'),
            // Agregar ya deja un reintento con un segundo de espera: la acción hace algo.
            run: () => {
              onChange({ ...rec, retries: 1, retryDelayMs: 1000 } as AnyStep);
              setRetryOpen(true);
            },
          },
    );
  }
  if (canContinue) {
    // Seguir si falla: el error queda como advertencia y la corrida sigue con el próximo paso.
    menu.push({
      key: 'continue',
      label: continues ? t('continueOff') : t('continueOn'),
      run: () => {
        const next = { ...rec } as Record<string, unknown>;
        if (continues) delete next.continueOnError;
        else next.continueOnError = true;
        onChange(next as AnyStep);
      },
    });
  }
  menu.push({ key: 'remove', label: t('remove'), danger: true, run: onRemove });

  return (
    <li className={`robots-step${invalid ? ' is-invalid' : ''}`} aria-labelledby={titleId}>
      <div className="robots-step-head">
        <span className="robots-step-num data">{num}</span>
        <h3 className="robots-step-type" id={titleId}>
          {t(`types.${step.type}`)}
          {invalid && <span className="robots-step-flag">{t('invalid')}</span>}
        </h3>
        {retries > 0 && <span className="badge">{t('retriesBadge', { count: retries })}</span>}
        {continues && <span className="badge badge-warn">{t('continueBadge')}</span>}
        {!readOnly && <StepMenu label={t('options', { num })} items={menu} />}
      </div>
      <div className="robots-step-body">
        <TypeFields step={step} readOnly={readOnly} onChange={onChange} prefix={`${num}.`} />
        {showRetry && (
          <div className="robots-retry">
            <div className="ui-field">
              <label className="label" htmlFor={`${titleId}-r`}>
                {t('fields.retries')}
              </label>
              <input
                id={`${titleId}-r`}
                ref={retryRef}
                className="input"
                type="number"
                min={0}
                max={5}
                value={retries}
                readOnly={readOnly}
                onChange={(e) => setNum('retries', e.target.value, 5)}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${titleId}-d`}>
                {t('fields.retryDelayMs')}
              </label>
              <input
                id={`${titleId}-d`}
                className="input"
                type="number"
                min={0}
                max={30000}
                step={250}
                value={Number(rec.retryDelayMs ?? 0)}
                readOnly={readOnly || retries === 0}
                onChange={(e) => setNum('retryDelayMs', e.target.value, 30_000)}
              />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

interface MenuItem {
  key: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** Menú "⋯" de un paso: botón con aria-haspopup, flechas, Home/End y Esc. */
function StepMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(focusButton: boolean) {
    setOpen(false);
    if (focusButton) btnRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="robots-menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <rect x="2" y="7" width="2.5" height="2.5" />
          <rect x="6.75" y="7" width="2.5" height="2.5" />
          <rect x="11.5" y="7" width="2.5" height="2.5" />
        </svg>
      </button>
      {open && (
        <div className="robots-menu" role="menu" id={menuId} aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`robots-menu-item${it.danger ? ' is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                close(true);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide, hint }: { label: string; children: (id: string) => ReactNode; wide?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={`ui-field${wide ? ' robots-wide' : ''}`}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="ui-help">{hint}</p>}
    </div>
  );
}

/** Campos de cada fila de un extract_list: nombre, selector dentro de la tarjeta y atributo. */
function ListFields({
  fields,
  readOnly,
  onChange,
}: {
  fields: RobotListField[];
  readOnly: boolean;
  onChange: (fields: RobotListField[]) => void;
}) {
  const t = useTranslations('robots.steps');
  const stable = useStableKeys(fields.length);
  const uid = useId();
  const set = (i: number, patch: Partial<RobotListField>) => onChange(fields.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="robots-list-fields">
      <legend className="label">{t('fields.listFields')}</legend>
      <div className="table-wrap">
        <table className="table robots-input-table">
          <thead>
            <tr>
              <th scope="col">{t('fields.fieldName')}</th>
              <th scope="col">{t('fields.fieldSelector')}</th>
              <th scope="col">{t('fields.fieldAttribute')}</th>
              <th scope="col">
                <span className="sr-only">{t('removeField')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={stable.keys[i]}>
                <td data-label={t('fields.fieldName')}>
                  <input
                    className="input data"
                    value={f.name}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="title"
                    aria-label={`${t('fields.fieldName')} ${i + 1}`}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td data-label={t('fields.fieldSelector')}>
                  <input
                    className="input data"
                    value={f.selector}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="h2"
                    aria-label={`${t('fields.fieldSelector')} ${i + 1}`}
                    aria-describedby={`${uid}-help`}
                    onChange={(e) => set(i, { selector: e.target.value })}
                  />
                </td>
                <td data-label={t('fields.fieldAttribute')}>
                  <input
                    className="input data"
                    value={f.attribute}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('fields.fieldText')}
                    aria-label={`${t('fields.fieldAttribute')} ${i + 1}`}
                    onChange={(e) => set(i, { attribute: e.target.value })}
                  />
                </td>
                <td className="robots-input-remove">
                  {!readOnly && fields.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      aria-label={`${t('removeField')} ${f.name || i + 1}`}
                      title={t('removeField')}
                      onClick={() => {
                        stable.remove(i);
                        onChange(fields.filter((_, k) => k !== i));
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
      <p className="ui-help" id={`${uid}-help`}>
        {t('listFieldsHint')}
      </p>
      {!readOnly && fields.length < MAX_LIST_FIELDS && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange([...fields, { name: `field${fields.length + 1}`, selector: '', attribute: '' }])}
        >
          {t('addField')}
        </button>
      )}
    </fieldset>
  );
}

function TypeFields({
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
  const text = (key: string, label: string, placeholder = '', wide = false, hint?: ReactNode) => (
    <Field key={key} label={label} wide={wide} hint={hint}>
      {(id) => (
        <input
          id={id}
          className="input data"
          value={String((step as Record<string, unknown>)[key] ?? '')}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const num = (key: string, label: string, min: number, max: number) => (
    <Field key={key} label={label}>
      {(id) => (
        <input
          id={id}
          className="input"
          type="number"
          min={min}
          max={max}
          value={Number((step as Record<string, unknown>)[key] ?? 0)}
          readOnly={readOnly}
          onChange={(e) => set({ [key]: Math.min(max, Math.max(min, Math.floor(Number(e.target.value) || 0))) })}
        />
      )}
    </Field>
  );
  const choice = (key: string, label: string, options: readonly string[], ns: 'modes' | 'onMissing') => (
    <Field key={key} label={label}>
      {(id) => (
        <select id={id} className="select" value={String((step as Record<string, unknown>)[key])} disabled={readOnly} onChange={(e) => set({ [key]: e.target.value })}>
          {options.map((m) => (
            <option key={m} value={m}>
              {t(`${ns}.${m}` as 'modes.text')}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  // Paginación (extract_list / extract_table): apagada = una sola página.
  const rec = step as Record<string, unknown>;
  const paginated = Number(rec.maxPages ?? 1) > 1;
  const pagination = (
    <>
      <label className="ui-check robots-wide">
        <input
          type="checkbox"
          checked={paginated}
          disabled={readOnly}
          onChange={(e) => {
            const next = { ...rec };
            if (e.target.checked) {
              next.maxPages = 5;
              if (!next.nextSelector && !next.nextText) next.nextText = t('nextTextDefault');
            } else {
              delete next.maxPages;
              delete next.nextSelector;
              delete next.nextText;
              delete next.pageWaitMs;
            }
            onChange(next as AnyStep);
          }}
        />
        <span>{t('fields.paginate')}</span>
      </label>
      {paginated && (
        <>
          {text('nextSelector', t('fields.nextSelector'), 'a[rel="next"]')}
          {text('nextText', t('fields.nextText'), t('nextTextDefault'))}
          {num('maxPages', t('fields.maxPages'), 2, MAX_PAGINATE_PAGES)}
          <Field label={t('fields.pageWaitMs')}>
            {(id) => (
              <input
                id={id}
                className="input"
                type="number"
                min={0}
                max={30000}
                step={250}
                value={Number(rec.pageWaitMs ?? 1000)}
                readOnly={readOnly}
                onChange={(e) => set({ pageWaitMs: Math.min(30_000, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
              />
            )}
          </Field>
          <p className="ui-help robots-wide">{t('paginateHint', { max: MAX_PAGINATE_PAGES })}</p>
        </>
      )}
    </>
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
          {choice('mode', t('fields.mode'), ['text', 'attribute', 'all'], 'modes')}
          {(step.mode === 'attribute' || step.mode === 'all') && text('attribute', t('fields.attribute'), 'href')}
        </div>
      );
    case 'extract_table':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'table')}
          {text('name', t('fields.name'), 'rows')}
          {pagination}
        </div>
      );
    case 'extract_list':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.cardSelector'), '.product-card', false, t('cardHint'))}
          {text('name', t('fields.name'), 'items')}
          {num('max', t('fields.maxRows'), 1, 500)}
          <div className="robots-wide">
            <ListFields fields={step.fields} readOnly={readOnly} onChange={(fields) => set({ fields })} />
          </div>
          {pagination}
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
          {choice('onMissing', t('fields.onMissing'), ['skip', 'goto', 'stop', 'fail'], 'onMissing')}
          {step.onMissing === 'skip' && num('count', t('fields.count'), 1, 100)}
          {step.onMissing === 'goto' && num('target', t('fields.target'), 1, 100)}
        </div>
      );
    case 'download':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'a.export')}
          {text('text', t('fields.text'), 'Export CSV')}
          {text('name', t('fields.name'), 'file', false, t('fileHint', { example: `{{vars.${step.name || 'file'}.url}}` }))}
        </div>
      );
    case 'upload':
      return (
        <div className="robots-fields">
          {text('selector', t('fields.selector'), 'input[type="file"]')}
          {text('filename', t('fields.filename'), 'cv.pdf')}
          {text('url', t('fields.fileUrl'), 'https://example.com/{{inputs.file}}', true)}
        </div>
      );
    case 'pdf':
      return (
        <div className="robots-fields">
          {text('name', t('fields.name'), 'pdf', false, t('fileHint', { example: `{{vars.${step.name || 'pdf'}.url}}` }))}
        </div>
      );
    case 'evaluate':
      return (
        <div className="robots-fields">
          <Field label={t('fields.script')} wide>
            {(id) => (
              <textarea
                id={id}
                className="textarea data"
                rows={5}
                value={step.script}
                readOnly={readOnly}
                spellCheck={false}
                onChange={(e) => set({ script: e.target.value })}
              />
            )}
          </Field>
          {text('name', t('fields.name'), 'result')}
        </div>
      );
    case 'loop_over':
      return (
        <div className="robots-fields">
          {text('list', t('fields.list'), '{{inputs.urls}}')}
          {num('max', t('fields.max'), 1, 50)}
          <label className="ui-check robots-wide">
            <input
              type="checkbox"
              checked={step.continueOnItemError === true}
              disabled={readOnly}
              onChange={(e) => {
                const next = { ...step } as Record<string, unknown>;
                if (e.target.checked) next.continueOnItemError = true;
                else delete next.continueOnItemError;
                onChange(next as AnyStep);
              }}
            />
            <span>{t('fields.continueOnItemError')}</span>
          </label>
          <div className="robots-wide">
            <StepList steps={step.steps} nested readOnly={readOnly} prefix={prefix} onChange={(steps) => set({ steps })} />
          </div>
        </div>
      );
    default:
      return null;
  }
}
