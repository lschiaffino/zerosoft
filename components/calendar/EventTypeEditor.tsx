'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { scheduleDisplayName } from '@/lib/calendar-schedule-name';
import { isZeroDecimal, minimumPriceCents, parsePriceInput, priceInputValue, priceProblem } from '@/lib/calendar-price';
import { isValidRedirectUrl } from '@/lib/calendar-redirect';
import { cleanOptions, MAX_GUESTS, OPTION_QUESTION_TYPES, QUESTION_TYPES, type Question } from '@/lib/calendar-questions';
import CalIcon from './cal-icons';
import CalCopyButton from './CalCopyButton';
import CalDeleteButton from './CalDeleteButton';
import WeeklyHours, { type HourRule } from './WeeklyHours';
import {
  LIMIT_KEYS,
  bookingRulesPayload,
  brandOr,
  fieldKeyFromLabel,
  formatTimezone,
  meetingLimitsDraft,
  meetingLimitsPayload,
  resolveBrand,
  safeLogo,
  slugify,
  usesDefaultLimits,
  type LimitKey,
  type Limits,
  type MeetingLimitsDraft,
} from './cal-utils';

export type QuestionDef = Question;

export interface ScheduleOption {
  id: string;
  name: string;
  timezone: string;
  /** Un renglón por día con horas, lunes primero. */
  summary: Array<{ day: string; ranges: string }>;
}

export interface WorkflowStepView {
  recipient: 'guest' | 'host';
  offsetMin: number;
  subject: string;
  body: string;
}

interface TeamMemberOption {
  user_id: string;
  email: string;
  name: string | null;
}

export interface EventTypeEditorProps {
  eventType: {
    id: string;
    slug: string;
    title: string;
    durationMin: number;
    location: string;
    description: string;
    color: string;
    active: boolean;
    bookingRules: Record<string, unknown>;
    fields: QuestionDef[];
    brandColor: string | null;
    welcomeMessage: string;
    logoUrl: string;
    singleUse: boolean;
    used: boolean;
    scheduleId: string | null;
    priceCents: number;
    currency: string;
    /** Reunión única: inicios ISO elegidos a mano (null = evento normal). */
    oneOffTimes: string[] | null;
  };
  schedules: ScheduleOption[];
  /** Marca del workspace (Ajustes > Perfil): la que usa la página si el evento no la cambia. */
  workspaceBrand: { color: string | null; logoUrl: string | null; name: string };
  customRules: HourRule[];
  /** Límites del calendario (Configuración): los que usa el evento si no define los suyos. */
  defaults: Limits;
  payments: { configured: boolean; ready: boolean };
  workflowSteps: WorkflowStepView[];
  teamMembers?: TeamMemberOption[];
  teamId?: string | null;
  hostIds: string[];
  handle: string;
  /** Origen público (https://zerosoft.ai) y base de reservas (…/es/book). */
  origin: string;
  bookBase: string;
  initialTab?: string;
}

const TABS = ['general', 'availability', 'questions', 'advanced', 'share'] as const;
type Tab = (typeof TABS)[number];
const CUSTOM = '__custom__';
const CURRENCIES = ['usd', 'eur', 'ars', 'brl', 'mxn', 'clp', 'cop', 'gbp'] as const;
const ERROR_CODES = [
  'invalid_slug',
  'slug_taken',
  'invalid_input',
  'invalid_range',
  'invalid_price',
  'invalid_schedule',
  'confirmation_paid',
  'generic',
];
/** Saltos de inicio ofrecidos ('' = cada duración). */
const INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
const PERIODS = ['day', 'week', 'month'] as const;

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };
interface StepDraft {
  recipient: 'guest' | 'host';
  amount: number;
  unit: Unit;
  when: 'before' | 'after';
  subject: string;
  body: string;
}
const VARIABLES = ['{{guest.name}}', '{{guest.email}}', '{{host.name}}', '{{event.title}}', '{{start}}', '{{link}}', '{{manage}}'];

function fromOffset(s: WorkflowStepView): StepDraft {
  const abs = Math.abs(s.offsetMin);
  const unit: Unit = abs > 0 && abs % 1440 === 0 ? 'days' : abs > 0 && abs % 60 === 0 ? 'hours' : 'minutes';
  return { recipient: s.recipient, amount: abs / UNIT_MIN[unit], unit, when: s.offsetMin > 0 ? 'after' : 'before', subject: s.subject, body: s.body };
}
function toOffset(d: StepDraft): number {
  const minutes = Math.round(d.amount * UNIT_MIN[d.unit]);
  return d.when === 'after' ? minutes : -minutes;
}

function initialLimits(rules: Record<string, unknown>, defaults: Limits): Limits {
  const out = { ...defaults };
  for (const k of LIMIT_KEYS) if (typeof rules[k] === 'number') out[k] = rules[k] as number;
  return out;
}

/** Estado del formulario que se compara para saber si hay cambios sin guardar. */
interface Draft {
  title: string;
  slug: string;
  durationMin: number;
  location: string;
  description: string;
  color: string;
  active: boolean;
  useDefaults: boolean;
  limits: Limits;
  singleUse: boolean;
  fields: QuestionDef[];
  hostIds: string[];
  /** El evento usa otro color o logo que la marca del workspace. */
  brandOverride: boolean;
  brandColor: string;
  logoUrl: string;
  welcomeMessage: string;
  schedule: string;
  customRules: HourRule[];
  amount: string;
  currency: string;
  steps: StepDraft[];
  /** Minutos entre inicios; '' = la duración. */
  slotInterval: string;
  meetingLimits: MeetingLimitsDraft;
  hostMeetingLimits: MeetingLimitsDraft;
  requiresConfirmation: boolean;
  redirectUrl: string;
  redirectPassDetails: boolean;
  allowGuests: boolean;
  /** Tope de invitados extra ('' = el máximo). */
  maxGuests: string;
  /** Reunión única: inicios como valor de <input type="datetime-local"> (hora local del navegador). */
  oneOffTimes: string[];
}

/** Horarios que puede ofrecer una reunión única (igual que el schema). */
const MAX_ONE_OFF_TIMES = 30;

/** Próximo horario sugerido al agregar una fila: una hora después del último, o mañana a las 10. */
function nextOneOffDefault(list: string[]): string {
  const last = [...list].reverse().find(Boolean);
  const base = last ? new Date(new Date(last).getTime() + 60 * 60_000) : new Date(Date.now() + 86_400_000);
  if (!last) base.setHours(10, 0, 0, 0);
  return toLocalInput(base.toISOString());
}

/** ISO → valor de datetime-local en la zona del navegador. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventTypeEditor(props: EventTypeEditorProps) {
  const { eventType: et, schedules, defaults, payments, teamMembers, teamId, handle, origin, bookBase } = props;
  const t = useTranslations('calendar');
  const locale = useLocale();
  const router = useRouter();
  const baseId = useId();

  const initial = useMemo<Draft>(
    () => ({
      title: et.title,
      slug: et.slug,
      durationMin: et.durationMin,
      location: et.location,
      description: et.description,
      color: et.color,
      active: et.active,
      useDefaults: usesDefaultLimits(et.bookingRules),
      limits: initialLimits(et.bookingRules, defaults),
      singleUse: et.singleUse,
      fields: et.fields,
      hostIds: props.hostIds,
      brandOverride: !!(et.brandColor || et.logoUrl),
      brandColor: et.brandColor ?? '',
      logoUrl: et.logoUrl,
      welcomeMessage: et.welcomeMessage,
      schedule: et.scheduleId ?? CUSTOM,
      customRules: props.customRules,
      amount: priceInputValue(et.priceCents, et.currency || 'usd'),
      currency: et.currency || 'usd',
      steps: props.workflowSteps.map(fromOffset),
      slotInterval: typeof et.bookingRules.slotIntervalMin === 'number' ? String(et.bookingRules.slotIntervalMin) : '',
      meetingLimits: meetingLimitsDraft(et.bookingRules.meetingLimits),
      hostMeetingLimits: meetingLimitsDraft(et.bookingRules.hostMeetingLimits),
      requiresConfirmation: et.bookingRules.requiresConfirmation === true,
      redirectUrl: typeof et.bookingRules.redirectUrl === 'string' ? et.bookingRules.redirectUrl : '',
      redirectPassDetails: et.bookingRules.redirectPassDetails === true,
      allowGuests: et.bookingRules.allowGuests === true,
      maxGuests: typeof et.bookingRules.maxGuests === 'number' ? String(et.bookingRules.maxGuests) : '',
      oneOffTimes: (et.oneOffTimes ?? []).map(toLocalInput),
    }),
    // El borrador arranca una vez; después de guardar, `baseline` toma el valor guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [d, setD] = useState<Draft>(initial);
  const oneOff = et.oneOffTimes !== null;
  const [baseline, setBaseline] = useState<Draft>(initial);
  const [tab, setTab] = useState<Tab>(
    TABS.includes(props.initialTab as Tab) ? (props.initialTab as Tab) : 'general',
  );
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<{ tab: Tab; message: string } | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({} as Record<Tab, HTMLButtonElement | null>);

  const dirty = JSON.stringify(d) !== JSON.stringify(baseline);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (state === 'saved' || state === 'error') setState('idle');
  };

  // Aviso del navegador si se va con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  function selectTab(next: Tab, focus = false) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'general') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // Sin history: la pestaña igual cambia.
    }
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, from: Tab) {
    const i = TABS.indexOf(from);
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    selectTab(TABS[(map[e.key] + TABS.length) % TABS.length], true);
  }

  // ---- precio ----
  const priceCents = parsePriceInput(d.amount, d.currency);
  const charging = priceCents !== null && priceCents > 0;
  const money = (cents: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: d.currency.toUpperCase() }).format(cents / 100);
    } catch {
      return `${d.currency.toUpperCase()} ${cents / 100}`;
    }
  };
  function priceError(): string | null {
    if (priceCents === null) {
      return isZeroDecimal(d.currency) && parsePriceInput(d.amount, 'usd') !== null
        ? t('payments.noCents', { currency: d.currency.toUpperCase() })
        : t('payments.invalidAmount');
    }
    const problem = priceProblem(priceCents, d.currency);
    if (problem === 'zero_decimal') return t('payments.noCents', { currency: d.currency.toUpperCase() });
    if (problem === 'below_minimum') return t('payments.belowMinimum', { min: money(minimumPriceCents(d.currency)) });
    return null;
  }

  function fail(where: Tab, message: string) {
    setError({ tab: where, message });
    setState('error');
    setTab(where);
  }

  async function readCode(res: Response | null): Promise<string> {
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return code && ERROR_CODES.includes(code) ? code : 'generic';
  }

  async function save() {
    if (state === 'saving') return;
    setError(null);
    // Validación propia: los campos de otras pestañas están ocultos y el navegador no los puede señalar.
    if (!d.title.trim()) return fail('general', t('editor.titleRequired'));
    if (!Number.isFinite(d.durationMin) || d.durationMin < 1) return fail('general', t('editor.durationInvalid'));
    if (!/^[a-z0-9-]+$/.test(d.slug)) return fail('share', t('errors.invalid_slug'));
    if (!oneOff && d.schedule === CUSTOM && d.customRules.some((r) => r.endTime <= r.startTime)) {
      return fail('availability', t('errors.invalid_range'));
    }
    if (d.fields.some((f) => !f.label.trim())) return fail('questions', t('editor.questionLabelRequired'));
    if (d.fields.some((f) => OPTION_QUESTION_TYPES.has(f.type) && cleanOptions(f.options).length === 0)) {
      return fail('questions', t('editor.questionOptionsRequired'));
    }
    const maxGuests = d.maxGuests.trim() ? Number(d.maxGuests) : undefined;
    if (maxGuests !== undefined && !(Number.isInteger(maxGuests) && maxGuests >= 1 && maxGuests <= MAX_GUESTS)) {
      return fail('questions', t('editor.maxGuestsInvalid', { max: MAX_GUESTS }));
    }
    const oneOffIso = oneOff ? d.oneOffTimes.filter(Boolean).map((v) => new Date(v)).filter((x) => !Number.isNaN(x.getTime())) : [];
    if (oneOff && oneOffIso.length === 0) return fail('availability', t('oneOff.timesRequired'));
    const meetingLimits = meetingLimitsPayload(d.meetingLimits);
    const hostMeetingLimits = meetingLimitsPayload(d.hostMeetingLimits);
    if (meetingLimits === null || hostMeetingLimits === null) return fail('availability', t('editor.meetingLimitsInvalid'));
    const pErr = priceError();
    if (pErr) return fail('advanced', pErr);
    if (d.requiresConfirmation && charging) return fail('advanced', t('errors.confirmation_paid'));
    const redirectUrl = d.redirectUrl.trim();
    if (redirectUrl && !isValidRedirectUrl(redirectUrl)) return fail('advanced', t('editor.redirectInvalid'));
    if (d.brandOverride && d.logoUrl.trim() && !safeLogo(d.logoUrl)) return fail('advanced', t('editor.logoInvalid'));

    setState('saving');
    const taken: string[] = [];
    const fields = d.fields.map((f) => {
      const name = f.name || fieldKeyFromLabel(f.label, [...taken, ...d.fields.map((x) => x.name).filter(Boolean)]);
      taken.push(name);
      const options = OPTION_QUESTION_TYPES.has(f.type) ? cleanOptions(f.options) : [];
      return { name, label: f.label.trim(), type: f.type, required: f.required, options };
    });
    const orderedHosts = teamMembers ? teamMembers.filter((m) => d.hostIds.includes(m.user_id)).map((m) => m.user_id) : undefined;
    const priceChanged = d.amount !== baseline.amount || d.currency !== baseline.currency;

    const res = await fetch(`/api/calendar/event-types/${et.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: d.title.trim(),
        slug: d.slug,
        durationMin: Math.round(d.durationMin),
        location: d.location.trim(),
        description: d.description.trim(),
        color: d.color,
        active: d.active,
        bookingRules: {
          ...bookingRulesPayload(et.bookingRules, d.useDefaults, d.limits),
          // undefined = se quita la regla (JSON.stringify no manda la clave).
          slotIntervalMin: d.slotInterval ? Number(d.slotInterval) : undefined,
          meetingLimits,
          hostMeetingLimits: teamMembers && teamMembers.length > 0 ? hostMeetingLimits : undefined,
          requiresConfirmation: d.requiresConfirmation || undefined,
          redirectUrl: redirectUrl || undefined,
          redirectPassDetails: redirectUrl && d.redirectPassDetails ? true : undefined,
          allowGuests: d.allowGuests || undefined,
          maxGuests: d.allowGuests ? maxGuests : undefined,
        },
        singleUse: d.singleUse,
        fields,
        brandColor: d.brandOverride ? d.brandColor || null : null,
        logoUrl: d.brandOverride ? d.logoUrl.trim() || null : null,
        welcomeMessage: d.welcomeMessage.trim(),
        hostIds: orderedHosts,
        teamId: orderedHosts && orderedHosts.length > 0 ? (teamId ?? undefined) : undefined,
        scheduleId: oneOff || d.schedule === CUSTOM ? undefined : d.schedule,
        ...(oneOff ? { oneOffTimes: oneOffIso.map((x) => x.toISOString()) } : {}),
        ...(priceChanged ? { priceCents: priceCents ?? 0, currency: d.currency } : {}),
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const code = await readCode(res);
      return fail(
        code === 'invalid_slug' || code === 'slug_taken' ? 'share' : code === 'invalid_price' || code === 'confirmation_paid' ? 'advanced' : tab,
        t(`errors.${code}`),
      );
    }

    // Horas propias: se guardan si cambiaron o si el evento venía de un horario reutilizable.
    if (!oneOff && d.schedule === CUSTOM && (baseline.schedule !== CUSTOM || JSON.stringify(d.customRules) !== JSON.stringify(baseline.customRules))) {
      const r = await fetch(`/api/calendar/event-types/${et.id}/availability`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: d.customRules }),
      }).catch(() => null);
      if (!r || !r.ok) return fail('availability', t(`errors.${await readCode(r)}`));
    }

    if (JSON.stringify(d.steps) !== JSON.stringify(baseline.steps)) {
      const r = await fetch(`/api/calendar/event-types/${et.id}/workflows`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          steps: d.steps.map((s) => ({ recipient: s.recipient, offsetMin: toOffset(s), subject: s.subject, body: s.body })),
        }),
      }).catch(() => null);
      if (!r || !r.ok) return fail('advanced', t('editor.remindersError'));
    }

    const savedDraft = { ...d, fields: fields.map((f) => ({ ...f })) };
    setD(savedDraft);
    setBaseline(savedDraft);
    setState('saved');
    router.refresh();
  }

  const publicUrl = `${bookBase}/${handle}/${baseline.slug}`;
  const selectedSchedule = schedules.find((s) => s.id === d.schedule);
  const wsBrand = resolveBrand(props.workspaceBrand);
  const brand = brandOr(d.brandColor, wsBrand.color);
  const pageBrand = d.brandOverride ? resolveBrand(props.workspaceBrand, { brand_color: d.brandColor, logo_url: d.logoUrl }) : wsBrand;
  const idFor = (k: string) => `${baseId}-${k}`;

  const tabLabel: Record<Tab, string> = {
    general: t('editor.tabGeneral'),
    availability: t('editor.tabAvailability'),
    questions: t('editor.tabQuestions'),
    advanced: t('editor.tabAdvanced'),
    share: t('editor.tabShare'),
  };

  const status =
    state === 'saving'
      ? t('common.saving')
      : state === 'saved'
        ? t('editor.saved')
        : state === 'error' && error
          ? error.message
          : dirty
            ? t('editor.unsaved')
            : null;

  return (
    <div className="ui-page cal-editor-page">
      <PageHeader
        back={{ href: '/app/calendar/event-types', label: t('eventTypes.title') }}
        title={
          <span className="cal-title-row">
            <span className="cal-swatch cal-swatch-lg" style={{ background: baseline.color }} aria-hidden="true" />
            {baseline.title}
            {!baseline.active && <span className="badge">{t('eventTypes.inactive')}</span>}
          </span>
        }
        description={
          <span className="cal-head-meta">
            <span className="cal-num">{t('editor.minutes', { n: baseline.durationMin })}</span>
            {baseline.location && <span>{baseline.location}</span>}
            <a href={publicUrl} target="_blank" rel="noreferrer" className="cal-head-url data">
              {publicUrl.replace(/^https?:\/\//, '')}
            </a>
          </span>
        }
        actions={
          <>
            <CalCopyButton text={publicUrl} />
            <a className="btn btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
              <CalIcon name="external" />
              {t('list.open')}
            </a>
            <CalDeleteButton
              url={`/api/calendar/event-types/${et.id}`}
              confirmText={t('list.deleteConfirm', { title: baseline.title })}
              redirectTo="/app/calendar/event-types"
            />
          </>
        }
      />

      <div className="ui-tabs" role="tablist" aria-label={t('editor.sections')}>
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={idFor(`tab-${k}`)}
            aria-selected={tab === k}
            aria-controls={idFor(`panel-${k}`)}
            tabIndex={tab === k ? 0 : -1}
            className="ui-tab"
            onClick={() => selectTab(k)}
            onKeyDown={(e) => onTabKey(e, k)}
          >
            {tabLabel[k]}
            {k === 'questions' && d.fields.length > 0 && <span className="ui-tab-count">{d.fields.length}</span>}
            {error?.tab === k && state === 'error' && <span className="cal-tab-alert" aria-label={t('editor.hasError')} />}
          </button>
        ))}
      </div>

      <form
        className="ui-section cal-editor"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ui-section-body">
          {/* ---------- General ---------- */}
          <Panel id={idFor('panel-general')} labelledBy={idFor('tab-general')} hidden={tab !== 'general'}>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('title')}>
                {t('form.title')}
              </label>
              <input
                id={idFor('title')}
                className="input"
                value={d.title}
                maxLength={200}
                aria-invalid={state === 'error' && error?.tab === 'general' && !d.title.trim() ? true : undefined}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={idFor('duration')}>
                  {t('quick.duration')}
                </label>
                <div className="ui-input-group">
                  <input
                    id={idFor('duration')}
                    className="input cal-num"
                    type="number"
                    min={1}
                    max={720}
                    value={Number.isFinite(d.durationMin) ? d.durationMin : ''}
                    onChange={(e) => set('durationMin', e.target.value === '' ? NaN : Number(e.target.value))}
                  />
                  <span className="ui-addon cal-unit">min</span>
                </div>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={idFor('location')}>
                  {t('form.location')}
                </label>
                <input
                  id={idFor('location')}
                  className="input"
                  value={d.location}
                  placeholder={t('form.locationPlaceholder')}
                  onChange={(e) => set('location', e.target.value)}
                />
              </div>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('description')}>
                {t('form.description')} <span className="ui-optional">{t('editor.optional')}</span>
              </label>
              <textarea
                id={idFor('description')}
                className="textarea"
                rows={3}
                value={d.description}
                placeholder={t('editor.descriptionPlaceholder')}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('color')}>
                {t('editor.eventColor')}
              </label>
              <div className="cal-color">
                <input id={idFor('color')} type="color" className="cal-color-input" value={d.color} onChange={(e) => set('color', e.target.value)} />
                <span className="data">{d.color.toUpperCase()}</span>
              </div>
              <p className="ui-help">{t('editor.eventColorHelp')}</p>
            </div>
            <label className="ui-switch">
              <input type="checkbox" role="switch" checked={d.active} onChange={(e) => set('active', e.target.checked)} />
              <span>
                {t('editor.acceptsBookings')}
                <span className="cal-switch-help">{d.active ? t('editor.acceptsOn') : t('editor.acceptsOff')}</span>
              </span>
            </label>
          </Panel>

          {/* ---------- Disponibilidad ---------- */}
          <Panel id={idFor('panel-availability')} labelledBy={idFor('tab-availability')} hidden={tab !== 'availability'}>
            {oneOff ? (
              <OneOffTimesEditor
                idPrefix={idFor('oneoff')}
                value={d.oneOffTimes}
                onChange={(next) => set('oneOffTimes', next)}
                used={et.used}
              />
            ) : (
              <>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('schedule')}>
                {t('schedules.pick')}
              </label>
              <select id={idFor('schedule')} className="select cal-select-wide" value={d.schedule} onChange={(e) => set('schedule', e.target.value)}>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {scheduleDisplayName(s.name, t('schedules.defaultName'))} · {formatTimezone(s.timezone, locale)}
                  </option>
                ))}
                <option value={CUSTOM}>{t('schedules.custom')}</option>
              </select>
              <p className="ui-help">
                {selectedSchedule ? t('editor.scheduleHelp') : t('schedules.customHint')}{' '}
                <Link href="/app/calendar/availability" className="cal-inline-link">
                  {t('schedules.manage')}
                </Link>
              </p>
            </div>
            {selectedSchedule ? (
              selectedSchedule.summary.length === 0 ? (
                <p className="cal-muted">{t('schedules.unavailable')}</p>
              ) : (
                <dl className="cal-hours-summary">
                  {selectedSchedule.summary.map((line) => (
                    <div key={line.day}>
                      <dt>{line.day}</dt>
                      <dd className="data">{line.ranges}</dd>
                    </div>
                  ))}
                </dl>
              )
            ) : (
              <WeeklyHours rules={d.customRules} onChange={(next) => set('customRules', next)} />
            )}

            <SubSection title={t('editor.startTimes')} description={t('editor.startTimesLead')}>
              <div className="ui-field">
                <label className="label" htmlFor={idFor('interval')}>
                  {t('editor.interval')}
                </label>
                <select
                  id={idFor('interval')}
                  className="select cal-select-wide"
                  value={d.slotInterval}
                  onChange={(e) => set('slotInterval', e.target.value)}
                >
                  <option value="">{t('editor.intervalSame', { n: Number.isFinite(d.durationMin) ? d.durationMin : 0 })}</option>
                  {INTERVALS.map((n) => (
                    <option key={n} value={String(n)}>
                      {t('editor.intervalEvery', { n })}
                    </option>
                  ))}
                </select>
              </div>
            </SubSection>

            <SubSection title={t('editor.meetingLimits')} description={t('editor.meetingLimitsLead')}>
              <LimitInputs
                idPrefix={idFor('ml')}
                value={d.meetingLimits}
                onChange={(next) => set('meetingLimits', next)}
              />
              {teamMembers && teamMembers.length > 0 && (
                <>
                  <p className="ui-help">{t('editor.hostLimitsLead')}</p>
                  <LimitInputs
                    idPrefix={idFor('hl')}
                    value={d.hostMeetingLimits}
                    onChange={(next) => set('hostMeetingLimits', next)}
                    host
                  />
                </>
              )}
            </SubSection>
              </>
            )}
          </Panel>

          {/* ---------- Preguntas ---------- */}
          <Panel id={idFor('panel-questions')} labelledBy={idFor('tab-questions')} hidden={tab !== 'questions'}>
            <p className="ui-help cal-panel-lead">{t('editor.questionsLead')}</p>
            <ul className="cal-q-list">
              <li className="cal-q-fixed">
                <span>{t('booking.name')}</span>
                <span className="badge badge-outline">{t('editor.always')}</span>
              </li>
              <li className="cal-q-fixed">
                <span>{t('booking.email')}</span>
                <span className="badge badge-outline">{t('editor.always')}</span>
              </li>
              {d.fields.map((f, i) => {
                const update = (patch: Partial<QuestionDef>) =>
                  set('fields', d.fields.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                const withOptions = OPTION_QUESTION_TYPES.has(f.type);
                return (
                  <li key={i} className="cal-q-item">
                    <div className="cal-q-row">
                      <input
                        className="input"
                        value={f.label}
                        aria-label={t('editor.questionN', { n: i + 1 })}
                        placeholder={t('editor.questionPlaceholder')}
                        aria-invalid={state === 'error' && error?.tab === 'questions' && !f.label.trim() ? true : undefined}
                        onChange={(e) => update({ label: e.target.value })}
                      />
                      <select
                        className="select"
                        value={f.type}
                        aria-label={t('editor.answerType')}
                        onChange={(e) => update({ type: e.target.value as QuestionDef['type'] })}
                      >
                        {QUESTION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`questionType.${type}`)}
                          </option>
                        ))}
                      </select>
                      <label className="ui-check">
                        <input type="checkbox" checked={f.required} onChange={(e) => update({ required: e.target.checked })} />
                        <span>{t('form.fieldRequired')}</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label={t('editor.removeQuestion', { n: i + 1 })}
                        title={t('common.remove')}
                        onClick={() => set('fields', d.fields.filter((_, k) => k !== i))}
                      >
                        <CalIcon name="trash" />
                      </button>
                    </div>
                    {withOptions && (
                      <div className="ui-field cal-q-options">
                        <label className="label" htmlFor={idFor(`q-${i}-options`)}>
                          {t('editor.questionOptions')}
                        </label>
                        <textarea
                          id={idFor(`q-${i}-options`)}
                          className="textarea"
                          rows={3}
                          value={f.options.join('\n')}
                          placeholder={t('editor.questionOptionsPlaceholder')}
                          aria-invalid={
                            state === 'error' && error?.tab === 'questions' && cleanOptions(f.options).length === 0 ? true : undefined
                          }
                          onChange={(e) => update({ options: e.target.value.split('\n') })}
                        />
                        <p className="ui-help">{t('editor.questionOptionsHelp')}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={d.fields.length >= 20}
                onClick={() => set('fields', [...d.fields, { name: '', label: '', type: 'text', required: false, options: [] }])}
              >
                <CalIcon name="plus" />
                {t('form.addField')}
              </button>
            </div>

            <SubSection title={t('editor.guests')} description={t('editor.guestsLead')}>
              <label className="ui-switch">
                <input type="checkbox" role="switch" checked={d.allowGuests} onChange={(e) => set('allowGuests', e.target.checked)} />
                <span>
                  {t('editor.allowGuests')}
                  <span className="cal-switch-help">{t('editor.allowGuestsHelp')}</span>
                </span>
              </label>
              {d.allowGuests && (
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('max-guests')}>
                    {t('editor.maxGuests')}
                  </label>
                  <input
                    id={idFor('max-guests')}
                    className="input cal-num cal-input-short"
                    type="number"
                    min={1}
                    max={MAX_GUESTS}
                    inputMode="numeric"
                    placeholder={String(MAX_GUESTS)}
                    value={d.maxGuests}
                    onChange={(e) => set('maxGuests', e.target.value)}
                  />
                  <p className="ui-help">{t('editor.maxGuestsHelp', { max: MAX_GUESTS })}</p>
                </div>
              )}
            </SubSection>
          </Panel>

          {/* ---------- Avanzado ---------- */}
          <Panel id={idFor('panel-advanced')} labelledBy={idFor('tab-advanced')} hidden={tab !== 'advanced'}>
            <SubSection title={t('editor.limits')} description={t('editor.limitsLead')}>
              <label className="ui-switch">
                <input type="checkbox" role="switch" checked={d.useDefaults} onChange={(e) => set('useDefaults', e.target.checked)} />
                <span>{t('editor.useDefaults')}</span>
              </label>
              {d.useDefaults ? (
                <p className="ui-help">
                  {t('editor.defaultsSummary', {
                    before: defaults.bufferBeforeMin,
                    after: defaults.bufferAfterMin,
                    notice: defaults.minNoticeHours,
                    days: defaults.maxFutureDays,
                  })}{' '}
                  <Link href="/app/calendar/settings" className="cal-inline-link">
                    {t('editor.changeDefaults')}
                  </Link>
                </p>
              ) : (
                <div className="ui-fields-2">
                  {(
                    [
                      ['bufferBeforeMin', t('settings.bufferBefore'), 'min', 0],
                      ['bufferAfterMin', t('settings.bufferAfter'), 'min', 0],
                      ['minNoticeHours', t('settings.minNotice'), 'h', 0],
                      ['maxFutureDays', t('settings.maxDays'), t('editor.daysUnit'), 1],
                    ] as Array<[LimitKey, string, string, number]>
                  ).map(([k, label, unit, min]) => (
                    <div key={k} className="ui-field">
                      <label className="label" htmlFor={idFor(k)}>
                        {label}
                      </label>
                      <div className="ui-input-group">
                        <input
                          id={idFor(k)}
                          className="input cal-num"
                          type="number"
                          min={min}
                          value={d.limits[k]}
                          onChange={(e) => set('limits', { ...d.limits, [k]: Math.max(min, Number(e.target.value) || min) })}
                        />
                        <span className="ui-addon cal-unit">{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!oneOff && (
                <label className="ui-switch">
                  <input type="checkbox" role="switch" checked={d.singleUse} onChange={(e) => set('singleUse', e.target.checked)} />
                  <span>
                    {t('form.singleUse')}
                    <span className="cal-switch-help">{et.used && d.singleUse ? t('form.singleUseUsed') : t('editor.singleUseHelp')}</span>
                  </span>
                </label>
              )}
            </SubSection>

            <SubSection title={t('editor.afterBooking')} description={t('editor.afterBookingLead')}>
              <label className="ui-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={d.requiresConfirmation}
                  onChange={(e) => set('requiresConfirmation', e.target.checked)}
                />
                <span>
                  {t('editor.requiresConfirmation')}
                  <span className="cal-switch-help">
                    {charging ? t('editor.requiresConfirmationPaid') : t('editor.requiresConfirmationHelp')}
                  </span>
                </span>
              </label>
              <div className="ui-field">
                <label className="label" htmlFor={idFor('redirect')}>
                  {t('editor.redirectUrl')} <span className="ui-optional">{t('editor.optional')}</span>
                </label>
                <input
                  id={idFor('redirect')}
                  className="input data"
                  type="url"
                  inputMode="url"
                  value={d.redirectUrl}
                  placeholder="https://example.com/thanks"
                  aria-invalid={d.redirectUrl.trim() && !isValidRedirectUrl(d.redirectUrl.trim()) ? true : undefined}
                  aria-describedby={idFor('redirect-help')}
                  onChange={(e) => set('redirectUrl', e.target.value)}
                />
                <p id={idFor('redirect-help')} className="ui-help">
                  {t('editor.redirectHelp')}
                </p>
              </div>
              {d.redirectUrl.trim() && (
                <label className="ui-check">
                  <input
                    type="checkbox"
                    checked={d.redirectPassDetails}
                    onChange={(e) => set('redirectPassDetails', e.target.checked)}
                  />
                  <span>{t('editor.redirectPassDetails')}</span>
                </label>
              )}
            </SubSection>

            {teamMembers && teamMembers.length > 0 && (
              <SubSection title={t('form.hosts')} description={t('form.hostsHelp')}>
                <div className="cal-hosts">
                  {teamMembers.map((m) => (
                    <label key={m.user_id} className="ui-check">
                      <input
                        type="checkbox"
                        checked={d.hostIds.includes(m.user_id)}
                        onChange={() =>
                          set('hostIds', d.hostIds.includes(m.user_id) ? d.hostIds.filter((x) => x !== m.user_id) : [...d.hostIds, m.user_id])
                        }
                      />
                      <span>
                        {m.name ?? m.email}
                        {m.name && <span className="cal-muted"> {m.email}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </SubSection>
            )}

            <SubSection title={t('form.branding')} description={t('editor.brandLead')}>
              <div className="cal-brand-current">
                <span className="cal-brand-chip" style={{ background: pageBrand.color }} aria-hidden="true" />
                <span className="cal-brand-current-text">
                  <strong>{pageBrand.name}</strong>
                  <span className="cal-muted">
                    {d.brandOverride ? t('editor.brandOwn') : t('editor.brandWorkspace')}{' '}
                    <Link href="/app/calendar/settings" className="cal-inline-link">
                      {t('editor.brandEdit')}
                    </Link>
                  </span>
                </span>
                <span className="cal-brand-preview" style={{ background: pageBrand.color, color: pageBrand.on }}>
                  {t('booking.confirm')}
                </span>
              </div>
              <label className="ui-switch">
                <input type="checkbox" role="switch" checked={d.brandOverride} onChange={(e) => set('brandOverride', e.target.checked)} />
                <span>
                  {t('editor.brandOverride')}
                  <span className="cal-switch-help">{t('editor.brandOverrideHelp')}</span>
                </span>
              </label>
              {d.brandOverride && (
                <div className="ui-fields-2">
                  <div className="ui-field">
                    <label className="label" htmlFor={idFor('brand')}>
                      {t('form.brandColor')}
                    </label>
                    <div className="cal-color">
                      <input
                        id={idFor('brand')}
                        type="color"
                        className="cal-color-input"
                        value={brand}
                        onChange={(e) => set('brandColor', e.target.value)}
                      />
                      <span className="data">{brand.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="ui-field">
                    <label className="label" htmlFor={idFor('logo')}>
                      {t('form.logoUrl')} <span className="ui-optional">{t('editor.optional')}</span>
                    </label>
                    <input
                      id={idFor('logo')}
                      className="input data"
                      value={d.logoUrl}
                      placeholder={props.workspaceBrand.logoUrl ?? 'https://…/logo.svg'}
                      onChange={(e) => set('logoUrl', e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="ui-field">
                <label className="label" htmlFor={idFor('welcome')}>
                  {t('form.welcomeMessage')} <span className="ui-optional">{t('editor.optional')}</span>
                </label>
                <textarea
                  id={idFor('welcome')}
                  className="textarea"
                  rows={2}
                  value={d.welcomeMessage}
                  placeholder={t('form.welcomeMessagePlaceholder')}
                  onChange={(e) => set('welcomeMessage', e.target.value)}
                />
              </div>
            </SubSection>

            <SubSection title={t('payments.title')} description={t('editor.paymentLead')}>
              <div className="cal-price">
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('price')}>
                    {t('payments.price')}
                  </label>
                  <input
                    id={idFor('price')}
                    className="input data"
                    inputMode="decimal"
                    value={d.amount}
                    aria-describedby={idFor('price-help')}
                    onChange={(e) => set('amount', e.target.value)}
                  />
                </div>
                <div className="ui-field">
                  <label className="label" htmlFor={idFor('currency')}>
                    {t('payments.currency')}
                  </label>
                  <select id={idFor('currency')} className="select" value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p id={idFor('price-help')} className="ui-help">
                {charging ? `${t('payments.charges', { amount: money(priceCents) })} ${t('payments.hint')}` : t('payments.free')}
              </p>
              {charging && !payments.ready && (
                <p className="cal-callout" role="note">
                  {t(payments.configured ? 'payments.eventWebhookMissing' : 'payments.notConfigured')}{' '}
                  <Link href="/app/calendar/settings?tab=payments" className="cal-inline-link">
                    {t('editor.goToPayments')}
                  </Link>
                </p>
              )}
            </SubSection>

            <SubSection title={t('workflows.title')} description={t('workflows.sub')}>
              {d.steps.length === 0 ? (
                <p className="cal-muted">{t('workflows.empty')}</p>
              ) : (
                <ol className="cal-steps">
                  {d.steps.map((s, i) => {
                    const upd = (p: Partial<StepDraft>) => set('steps', d.steps.map((x, j) => (j === i ? { ...x, ...p } : x)));
                    return (
                      <li key={i} className="cal-step">
                        <div className="cal-step-when">
                          <span className="cal-step-word">{t('editor.sendTo')}</span>
                          <select
                            className="select"
                            aria-label={t('workflows.to')}
                            value={s.recipient}
                            onChange={(e) => upd({ recipient: e.target.value as StepDraft['recipient'] })}
                          >
                            <option value="guest">{t('workflows.guest')}</option>
                            <option value="host">{t('workflows.host')}</option>
                          </select>
                          <input
                            className="input data cal-step-amount"
                            type="number"
                            min={0}
                            aria-label={t('editor.amount')}
                            value={s.amount}
                            onChange={(e) => upd({ amount: Math.max(0, Number(e.target.value) || 0) })}
                          />
                          <select className="select" aria-label={t('editor.unit')} value={s.unit} onChange={(e) => upd({ unit: e.target.value as Unit })}>
                            <option value="minutes">{t('workflows.minutes')}</option>
                            <option value="hours">{t('workflows.hours')}</option>
                            <option value="days">{t('workflows.days')}</option>
                          </select>
                          <select
                            className="select"
                            aria-label={t('editor.when')}
                            value={s.when}
                            onChange={(e) => upd({ when: e.target.value as StepDraft['when'] })}
                          >
                            <option value="before">{t('workflows.before')}</option>
                            <option value="after">{t('workflows.after')}</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            aria-label={t('editor.removeReminder', { n: i + 1 })}
                            title={t('common.remove')}
                            onClick={() => set('steps', d.steps.filter((_, j) => j !== i))}
                          >
                            <CalIcon name="trash" />
                          </button>
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={idFor(`subj-${i}`)}>
                            {t('workflows.subject')}
                          </label>
                          <input id={idFor(`subj-${i}`)} className="input" value={s.subject} maxLength={200} onChange={(e) => upd({ subject: e.target.value })} />
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={idFor(`body-${i}`)}>
                            {t('workflows.body')}
                          </label>
                          <textarea id={idFor(`body-${i}`)} className="textarea" rows={4} value={s.body} maxLength={5000} onChange={(e) => upd({ body: e.target.value })} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="cal-row-gap">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={d.steps.length >= 10}
                  onClick={() =>
                    set('steps', [
                      ...d.steps,
                      {
                        recipient: 'guest',
                        amount: 1,
                        unit: 'hours',
                        when: 'before',
                        // Las plantillas llevan {{…}}: se leen crudas para que el formateo de mensajes no las toque.
                        subject: String(t.raw('workflows.defaultSubject')),
                        body: String(t.raw('workflows.defaultBody')),
                      },
                    ])
                  }
                >
                  <CalIcon name="plus" />
                  {t('workflows.add')}
                </button>
              </div>
              <p className="ui-help">
                {t('editor.variables')} <span className="data">{VARIABLES.join(' ')}</span>
              </p>
              <p className="ui-help">{t('workflows.cronNote')}</p>
            </SubSection>
          </Panel>

          {/* ---------- Compartir ---------- */}
          <Panel id={idFor('panel-share')} labelledBy={idFor('tab-share')} hidden={tab !== 'share'}>
            <div className="ui-field">
              <label className="label" htmlFor={idFor('slug')}>
                {t('editor.link')}
              </label>
              <div className="ui-input-group">
                <span className="ui-addon">/{handle}/</span>
                <input
                  id={idFor('slug')}
                  className="input data"
                  value={d.slug}
                  aria-invalid={!/^[a-z0-9-]+$/.test(d.slug) || undefined}
                  aria-describedby={idFor('slug-help')}
                  onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                />
              </div>
              <p id={idFor('slug-help')} className="ui-help">
                {d.slug !== baseline.slug ? t('editor.slugWarning') : t('editor.slugHelp')}
                {d.slug !== slugify(d.title) && slugify(d.title) && (
                  <>
                    {' '}
                    <button type="button" className="cal-inline-link" onClick={() => set('slug', slugify(d.title))}>
                      {t('editor.useTitleSlug', { slug: slugify(d.title) })}
                    </button>
                  </>
                )}
              </p>
            </div>
            <div className="cal-share-url">
              <span className="data">{publicUrl}</span>
              <CalCopyButton text={publicUrl} />
            </div>
            <EmbedSnippet publicUrl={publicUrl} origin={origin} />
          </Panel>
        </div>

        <div className="ui-section-foot cal-savebar">
          <p className="ui-section-note" role="status" aria-live="polite" data-tone={state === 'saved' ? 'ok' : state === 'error' ? 'error' : undefined}>
            {status}
          </p>
          <button type="submit" className="btn btn-primary" aria-busy={state === 'saving' || undefined} disabled={!dirty && state !== 'error'}>
            {t('editor.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Panel({ id, labelledBy, hidden, children }: { id: string; labelledBy: string; hidden: boolean; children: ReactNode }) {
  return (
    <div id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={hidden} className="cal-panel" tabIndex={0}>
      {children}
    </div>
  );
}

/**
 * Horarios de una reunión única: una fila por inicio (fecha y hora en la zona
 * del navegador). Quedan apartados en tu agenda hasta que alguien reserve uno.
 */
function OneOffTimesEditor({
  idPrefix,
  value,
  onChange,
  used,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
  used: boolean;
}) {
  const t = useTranslations('calendar');
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, []);
  return (
    <SubSection title={t('oneOff.timesTitle')} description={t('oneOff.timesLead', { timezone: tz })}>
      {used && <p className="ui-help">{t('oneOff.usedNote')}</p>}
      <ul className="cal-oneoff-list">
        {value.map((v, i) => (
          <li key={i} className="cal-oneoff-row">
            <input
              id={`${idPrefix}-${i}`}
              className="input data"
              type="datetime-local"
              value={v}
              aria-label={t('oneOff.timeN', { n: i + 1 })}
              onChange={(e) => onChange(value.map((x, k) => (k === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={t('oneOff.removeTime', { n: i + 1 })}
              title={t('common.remove')}
              onClick={() => onChange(value.filter((_, k) => k !== i))}
            >
              <CalIcon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={value.length >= MAX_ONE_OFF_TIMES}
          onClick={() => onChange([...value, nextOneOffDefault(value)])}
        >
          <CalIcon name="plus" />
          {t('oneOff.addTime')}
        </button>
      </div>
    </SubSection>
  );
}

/** Tres campos (día, semana, mes) de topes de reuniones; vacío = sin tope. */
function LimitInputs({
  idPrefix,
  value,
  onChange,
  host = false,
}: {
  idPrefix: string;
  value: MeetingLimitsDraft;
  onChange: (next: MeetingLimitsDraft) => void;
  host?: boolean;
}) {
  const t = useTranslations('calendar');
  return (
    <div className="cal-limits">
      {PERIODS.map((p) => (
        <div key={p} className="ui-field">
          <label className="label" htmlFor={`${idPrefix}-${p}`}>
            {t(host ? `editor.hostLimit_${p}` : `editor.limit_${p}`)}
          </label>
          <input
            id={`${idPrefix}-${p}`}
            className="input cal-num"
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            placeholder={t('editor.noLimit')}
            value={value[p]}
            onChange={(e) => onChange({ ...value, [p]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function SubSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="cal-sub" aria-labelledby={id}>
      <div className="cal-sub-head">
        <h3 className="cal-sub-title" id={id}>
          {title}
        </h3>
        {description && <p className="ui-help">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function EmbedSnippet({ publicUrl, origin }: { publicUrl: string; origin: string }) {
  const t = useTranslations('calendar');
  const [mode, setMode] = useState<'inline' | 'popup'>('inline');
  const snippet =
    mode === 'inline'
      ? `<script src="${origin}/api/calendar/embed.js" data-url="${publicUrl}" async></script>`
      : `<script src="${origin}/api/calendar/embed.js" data-url="${publicUrl}" data-mode="popup" data-label="${t('embed.popupLabel')}" async></script>`;
  return (
    <section className="cal-sub" aria-label={t('embed.title')}>
      <div className="cal-sub-head cal-sub-head-row">
        <h3 className="cal-sub-title">{t('embed.title')}</h3>
        <div className="btn-group" role="group" aria-label={t('embed.title')}>
          {(['inline', 'popup'] as const).map((m) => (
            <button key={m} type="button" className="btn btn-sm" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`embed.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="ui-help">{t(`embed.${mode}Desc`)}</p>
      <div className="cal-code">
        <pre className="data">{snippet}</pre>
        <CalCopyButton text={snippet} label={t('editor.copyCode')} className="btn btn-sm btn-ghost" />
      </div>
    </section>
  );
}
