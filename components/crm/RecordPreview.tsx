'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCrmLive } from './useCrmLive';
import { searchAssociable } from './assocSearch';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';
import AssociationPanel, { type AssociationOption } from './AssociationPanel';
import PreviewActions, { RecentActivity, type RecentItem } from './PreviewActions';
import { useCrmAdmin, useCrmOptions } from './CrmViewer';
import { customLayoutName, defaultPreviewLayout, type LayoutEntity, type PreviewLayout } from '@/lib/crm-layouts-shared';
import { clearLeadCompany, clearLeadContact, setLeadCompany, setLeadContact } from './leadServerActions';
import PhoneTouch from './PhoneTouch';
import PropertiesPanel, { type PropField } from './PropertiesPanel';
import DealStagePanel, { type StageOption } from './DealStagePanel';
import { customFieldSections, customPropFields } from './customPropFields';
import { formatPhoneDisplay } from '@/lib/crm-calls';
import { DEAL_TYPES, PRIORITIES, SOURCES } from '@/lib/crm-constants';
import type { CrmCustomFieldRow } from '@/lib/schema/types';

export type PreviewType = 'contact' | 'company' | 'deal' | 'lead';

interface PreviewContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  lead_status: string;
  source: string;
  owner_id: string | null;
  user_id?: string;
  custom: string;
}

interface PreviewCompany {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number | null;
  phone: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  description?: string | null;
  owner_id: string | null;
  user_id?: string;
  custom: string;
}

interface PreviewDeal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  close_date: string | null;
  priority: string;
  source: string;
  description: string;
  deal_type?: string | null;
  next_step?: string | null;
  stage_id: string;
  pipeline_id: string;
  owner_id: string | null;
  user_id?: string;
  custom: string;
}

interface ContactPayload {
  contact: PreviewContact;
  company: PreviewCompany | null;
  companies?: PreviewCompany[];
  deals: Array<PreviewDeal & { stage_name: string; pipeline_name: string }>;
}

interface CompanyPayload {
  company: PreviewCompany;
  contacts: PreviewContact[];
  deals: PreviewDeal[];
}

interface DealPayload {
  deal: PreviewDeal;
  pipeline: { id: string; name: string } | null;
  contacts: PreviewContact[];
  company: PreviewCompany | null;
  companies?: PreviewCompany[];
}

/** El lead llega plano (GET /api/crm/leads/<id>): sus asociados vienen como columnas. */
interface PreviewLead {
  id: string;
  name: string;
  stage_id: string;
  stage_name: string | null;
  stage_kind: 'open' | 'qualified' | 'disqualified' | null;
  source: string;
  disqualify_reason: string;
  owner_id: string | null;
  user_id?: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_private?: boolean;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_private?: boolean;
  deal_id: string | null;
  deal_name: string | null;
  deal_private?: boolean;
  custom: string;
}

type PreviewPayload = ContactPayload | CompanyPayload | DealPayload | PreviewLead;
type FieldDef = CrmCustomFieldRow & { access?: 'edit' | 'read' | 'hidden' };

interface RecordPreviewProps {
  type: PreviewType;
  id: string;
  locale: string;
  onClose: () => void;
  /** Personas del workspace: la propiedad Propietario se edita con esta lista (sin ella, no aparece). */
  owners?: Array<{ value: string; label: string }>;
  /** Anterior / siguiente de la tabla o el board que la abrió (RecordNav.tsx PreviewNav). */
  nav?: ReactNode;
}

const PLURAL: Record<PreviewType, LayoutEntity> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  lead: 'leads',
};

function parseCustom(json: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Fecha sin hora (close date): un día del calendario, no medianoche UTC. */
function formatDay(day: string | null, locale: string): string {
  if (!day) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
  } catch {
    return day;
  }
}

function contactName(c: Pick<PreviewContact, 'first_name' | 'last_name' | 'email'>): string {
  return `${c.first_name} ${c.last_name}`.trim() || c.email || '—';
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/**
 * Vista previa lateral de un registro (como la de HubSpot): propiedades
 * editables en línea con los mismos permisos que la ficha (el servidor los
 * aplica: PATCH /api/crm/<objeto>/<id>), asociaciones y "Abrir registro".
 */
export default function RecordPreview({ type, id, locale, onClose, owners = [], nav }: RecordPreviewProps) {
  const t = useTranslations('crm');
  const crmOpts = useCrmOptions();
  const plural = PLURAL[type];
  const titleId = useId();
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [layout, setLayout] = useState<PreviewLayout>(() => defaultPreviewLayout(PLURAL[type]));
  /** La configuración ya llegó (la actividad reciente no se pide si está oculta). */
  const [layoutReady, setLayoutReady] = useState(false);
  /** Lo guardado en `custom` desde la última lectura, compartido por los dos paneles de propiedades. */
  const savedCustom = useRef<Record<string, unknown>>({});
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const isAdmin = useCrmAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Vuelve a leer el registro (después de guardar) sin mostrar "cargando". Solo vale la última
  // lectura: una respuesta vieja que llega tarde no pisa a una más nueva.
  const reloadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    const res = await fetch(`/api/crm/${plural}/${id}`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok || seq !== reloadSeq.current) return;
    const data = (await res.json()) as PreviewPayload;
    if (seq === reloadSeq.current) setPayload(data);
  }, [plural, id]);

  // Actividad reciente: las mismas que la ficha le muestra a la persona (GET /api/crm/timeline).
  const recentSeq = useRef(0);
  const loadRecent = useCallback(async () => {
    const seq = ++recentSeq.current;
    setRecentLoading(true);
    const res = await fetch(`/api/crm/timeline?kind=${type}&id=${encodeURIComponent(id)}&offset=0`, { cache: 'no-store' }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: RecentItem[] } | null) : null;
    if (seq !== recentSeq.current) return;
    // Lo último que pasó: por fecha de creación (el timeline pone primero lo fijado y las tareas por vencimiento).
    const items = [...(data?.items ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    setRecent(items.slice(0, 3));
    setRecentLoading(false);
  }, [type, id]);
  const showRecent = layoutReady && layout.sections.includes('activity');
  useEffect(() => {
    if (showRecent) void loadRecent();
  }, [showRecent, loadRecent]);

  // En vivo: si un compañero cambia este registro (algo que esta persona ve), se vuelve a leer.
  // Si deja de estar (otra persona lo borró o ya no lo ve), se avisa en vez de mostrar datos viejos.
  // El lead no tiene firma de ficha: se firma como una lista de uno (lib/crm-live.ts).
  const [gone, setGone] = useState(false);
  useEffect(() => setGone(false), [type, id]);
  useCrmLive(
    type === 'lead' ? { list: 'leads', ids: [id] } : { record: { kind: type, id } },
    () => {
      void reload();
      if (showRecent) void loadRecent();
    },
    { onGone: () => setGone(true) },
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([
      fetch(`/api/crm/${plural}/${id}`, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<PreviewPayload>) : null)),
      // Definiciones con el acceso de la persona: las ocultas no llegan, las de solo lectura vienen marcadas.
      fetch(`/api/crm/custom-fields?entity=${plural}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: FieldDef[] }>) : { rows: [] }))
        .catch(() => ({ rows: [] as FieldDef[] })),
      type === 'deal'
        ? fetch('/api/crm/pipelines')
            .then((r) => (r.ok ? (r.json() as Promise<{ rows: Array<{ id: string; stages: StageOption[] }> }>) : { rows: [] }))
            .catch(() => ({ rows: [] as Array<{ id: string; stages: StageOption[] }> }))
        : type === 'lead'
          ? // Las etapas de leads, como un solo "pipeline".
            fetch('/api/crm/lead-stages')
              .then((r) => (r.ok ? (r.json() as Promise<{ rows: StageOption[] }>) : { rows: [] as StageOption[] }))
              .then((d) => ({ rows: [{ id: '', stages: d.rows }] }))
              .catch(() => ({ rows: [] as Array<{ id: string; stages: StageOption[] }> }))
          : Promise.resolve(null),
      // Qué muestra la vista previa (Ajustes › Datos), ya sin las propiedades que la persona tiene ocultas.
      fetch(`/api/crm/layouts?kind=preview&entity=${plural}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ layout: PreviewLayout }>) : null))
        .catch(() => null),
    ])
      .then(([data, fieldRows, pipelines, layoutRes]) => {
        if (cancelled) return;
        setPayload(data);
        setDefs(fieldRows.rows ?? []);
        if (layoutRes?.layout) setLayout(layoutRes.layout);
        setLayoutReady(true);
        if (data && pipelines && 'deal' in data) {
          const p = pipelines.rows.find((x) => x.id === (data as DealPayload).deal.pipeline_id);
          setStages(p?.stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost })) ?? []);
        } else if (pipelines && type === 'lead') {
          // Las etapas de lead no ganan ni pierden: solo se usan como opciones del select.
          setStages(pipelines.rows[0]?.stages.map((s) => ({ id: s.id, name: s.name, is_won: 0 as const, is_lost: 0 as const })) ?? []);
        }
        setError(!data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plural, id, type, attempt]);

  // Es un diálogo: el foco entra al abrir y vuelve a donde estaba al cerrar.
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Esc que ya usó otro (cancelar una edición, cerrar un diálogo encima) no cierra el panel.
        if (e.defaultPrevented) return;
        if (document.querySelector('dialog[open], .modal-overlay')) return;
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // El foco no sale del diálogo.
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex="0"]') ?? [],
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const detailHref = `/app/crm/${plural}/${id}`;
  const endpoint = `/api/crm/${plural}/${id}`;

  const record = payload
    ? type === 'contact'
      ? (payload as ContactPayload).contact
      : type === 'company'
        ? (payload as CompanyPayload).company
        : type === 'lead'
          ? (payload as PreviewLead)
          : (payload as DealPayload).deal
    : null;
  const customJson = record?.custom;
  const custom = useMemo(() => parseCustom(customJson), [customJson]);

  const ownerOptions = owners;
  // Sin propietario es el dueño del workspace (como en la ficha): no se ofrece "—", que
  // dejaría a un member sin acceso a un registro que estaba viendo.
  const ownerField = (ownerId: string | null, workspaceId: string | undefined, label: string): PropField[] =>
    ownerOptions.length ? [{ key: 'ownerId', label, type: 'select', value: ownerId ?? workspaceId ?? '', options: ownerOptions }] : [];

  const customFields = customPropFields(defs, custom, { yes: t('common.yes'), no: t('common.no'), locale, owners: ownerOptions });

  function standardFields(): PropField[] {
    if (!payload) return [];
    if (type === 'contact') {
      const c = (payload as ContactPayload).contact;
      return [
        { key: 'firstName', label: t('contacts.form.firstName'), type: 'text', value: c.first_name },
        { key: 'lastName', label: t('contacts.form.lastName'), type: 'text', value: c.last_name },
        { key: 'email', label: t('contacts.form.email'), type: 'text', value: c.email },
        { key: 'phone', label: t('contacts.form.phone'), type: 'text', inputType: 'tel', value: c.phone, display: formatPhoneDisplay(c.phone) },
        { key: 'jobTitle', label: t('contacts.form.jobTitle'), type: 'text', value: c.job_title },
        {
          key: 'lifecycleStage',
          label: t('contacts.form.lifecycle'),
          type: 'select',
          value: c.lifecycle_stage,
          options: crmOpts.choices('lifecycle', c.lifecycle_stage),
        },
        {
          key: 'leadStatus',
          label: t('contacts.form.leadStatus'),
          type: 'select',
          value: c.lead_status,
          options: crmOpts.choices('leadStatus', c.lead_status),
        },
        ...ownerField(c.owner_id, c.user_id, t('contacts.form.owner')),
        {
          key: 'source',
          label: t('contacts.form.source'),
          type: 'select',
          value: c.source,
          // La API no acepta source vacío: '—' solo si ya está vacío.
          options: [...(c.source === '' ? [{ value: '', label: '—' }] : []), ...SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) }))],
        },
        { key: 'website', label: t('contacts.form.website'), type: 'text', value: c.website },
        { key: 'city', label: t('contacts.form.city'), type: 'text', value: c.city },
        { key: 'country', label: t('contacts.form.country'), type: 'text', value: c.country },
      ];
    }
    if (type === 'lead') {
      const l = payload as PreviewLead;
      return [
        { key: 'name', label: t('leads.form.name'), type: 'text', value: l.name },
        ...(stages.length
          ? [{ key: 'stageId', label: t('leads.form.stage'), type: 'select' as const, value: l.stage_id, options: stages.map((s) => ({ value: s.id, label: s.name })) }]
          : []),
        ...ownerField(l.owner_id, l.user_id, t('leads.form.owner')),
        {
          key: 'source',
          label: t('leads.form.source'),
          type: 'select',
          value: l.source,
          options: [{ value: '', label: '—' }, ...SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) }))],
        },
        { key: 'disqualifyReason', label: t('leads.disqualify.reason'), type: 'text', value: l.disqualify_reason ?? '' },
      ];
    }
    if (type === 'company') {
      const c = (payload as CompanyPayload).company;
      return [
        { key: 'name', label: t('companies.form.name'), type: 'text', value: c.name },
        { key: 'domain', label: t('companies.form.domain'), type: 'text', value: c.domain },
        { key: 'industry', label: t('companies.form.industry'), type: 'text', value: c.industry },
        { key: 'phone', label: t('companies.form.phone'), type: 'text', inputType: 'tel', value: c.phone, display: formatPhoneDisplay(c.phone) },
        {
          key: 'lifecycleStage',
          label: t('companies.form.lifecycle'),
          type: 'select',
          value: c.lifecycle_stage,
          options: crmOpts.choices('lifecycle', c.lifecycle_stage),
        },
        ...ownerField(c.owner_id, c.user_id, t('companies.form.owner')),
        { key: 'city', label: t('companies.form.city'), type: 'text', value: c.city },
        { key: 'country', label: t('companies.form.country'), type: 'text', value: c.country },
        { key: 'employees', label: t('companies.form.employees'), type: 'number', value: c.employees === null ? '' : String(c.employees) },
        { key: 'website', label: t('companies.form.website'), type: 'text', value: c.website },
        { key: 'description', label: t('companiesEnrich.description'), type: 'textarea', value: c.description ?? '' },
      ];
    }
    const d = (payload as DealPayload).deal;
    return [
      { key: 'name', label: t('deals.form.name'), type: 'text', value: d.name },
      { key: 'amount', label: t('deals.form.amount'), type: 'number', value: String(d.amount), display: formatMoney(d.amount, d.currency, locale) },
      { key: 'closeDate', label: t('deals.form.closeDate'), type: 'date', value: d.close_date ?? '', display: formatDay(d.close_date, locale) || undefined, nullOption: true },
      ...ownerField(d.owner_id, d.user_id, t('deals.form.owner')),
      {
        key: 'priority',
        label: t('deals.form.priority'),
        type: 'select',
        value: d.priority,
        options: PRIORITIES.map((v) => ({ value: v, label: t(`enums.priority.${v}`) })),
      },
      {
        key: 'dealType',
        label: t('deals.form.dealType'),
        type: 'select',
        value: d.deal_type ?? '',
        options: [{ value: '', label: '—' }, ...DEAL_TYPES.map((v) => ({ value: v as string, label: t(`enums.dealType.${v}`) }))],
      },
      { key: 'nextStep', label: t('deals.form.nextStep'), type: 'text', value: d.next_step ?? '' },
      {
        key: 'source',
        label: t('deals.form.source'),
        type: 'select',
        value: d.source,
        options: [...(d.source === '' ? [{ value: '', label: '—' }] : []), ...SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) }))],
      },
      { key: 'currency', label: t('deals.form.currency'), type: 'text', value: d.currency },
      { key: 'description', label: t('deals.form.description'), type: 'textarea', value: d.description },
    ];
  }

  // Pre-fill del booking: contacto directo, o primer contacto del deal.
  let prefillName: string | undefined;
  let prefillEmail: string | undefined;
  if (payload && type === 'contact') {
    const c = (payload as ContactPayload).contact;
    prefillName = `${c.first_name} ${c.last_name}`.trim() || undefined;
    prefillEmail = c.email || undefined;
  } else if (payload && type === 'lead') {
    const l = payload as PreviewLead;
    prefillName = l.contact_name || undefined;
    prefillEmail = l.contact_email || undefined;
  } else if (payload && type === 'deal' && (payload as DealPayload).contacts.length > 0) {
    const c = (payload as DealPayload).contacts[0];
    prefillName = `${c.first_name} ${c.last_name}`.trim() || undefined;
    prefillEmail = c.email || undefined;
  }

  function renderHeader() {
    if (!payload) return null;
    let title = '';
    let lines: React.ReactNode[] = [];
    // Datos clave bajo el nombre (como los "highlights" de HubSpot): nombre del dato y valor, a la izquierda.
    let facts: Array<{ key: string; label: string; value: React.ReactNode }> = [];
    if (type === 'contact') {
      const c = (payload as ContactPayload).contact;
      const company = (payload as ContactPayload).company;
      title = contactName(c);
      const role = [c.job_title, company?.name].filter(Boolean).join(' · ');
      lines = [
        role && <span key="role">{role}</span>,
        c.email && (
          <a key="email" href={`mailto:${c.email}`} className="preview-meta-link">
            {c.email}
          </a>
        ),
        c.phone && (
          <span key="phone" className="preview-meta-phone">
            {formatPhoneDisplay(c.phone)} <PhoneTouch phone={c.phone} contactId={c.id} />
          </span>
        ),
      ];
    } else if (type === 'lead') {
      const l = payload as PreviewLead;
      title = l.name;
      lines = [
        l.contact_id && (
          <span key="contact">{[l.contact_name, l.contact_email].filter(Boolean).join(' · ')}</span>
        ),
        l.company_name && <span key="company">{l.company_name}</span>,
      ];
      const stageName = stages.find((s) => s.id === l.stage_id)?.name ?? l.stage_name;
      facts = [
        ...(stageName ? [{ key: 'stage', label: t('leads.form.stage'), value: stageName }] : []),
        ...(owners.length
          ? [{ key: 'owner', label: t('leads.form.owner'), value: owners.find((o) => o.value === (l.owner_id ?? l.user_id))?.label ?? '—' }]
          : []),
      ];
    } else if (type === 'company') {
      const c = (payload as CompanyPayload).company;
      title = c.name;
      const where = [c.industry, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
      lines = [
        c.domain && (
          <a key="domain" href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="preview-meta-link">
            {c.domain} <CrmIcon name="external" size={12} />
          </a>
        ),
        where && <span key="where">{where}</span>,
      ];
    } else {
      const p = payload as DealPayload;
      title = p.deal.name;
      const stageName = stages.find((s) => s.id === p.deal.stage_id)?.name;
      facts = [
        { key: 'amount', label: t('deals.form.amount'), value: <span className="num">{formatMoney(p.deal.amount, p.deal.currency, locale)}</span> },
        { key: 'close', label: t('deals.form.closeDate'), value: p.deal.close_date ? formatDay(p.deal.close_date, locale) : '—' },
        ...(stageName ? [{ key: 'stage', label: t('deals.form.stage'), value: stageName }] : []),
      ];
    }
    const shown = lines.filter(Boolean);
    return (
      <div className="preview-header">
        <div className="preview-ident">
          <span className={`preview-avatar preview-avatar-${type}`} aria-hidden="true">
            {initials(title)}
          </span>
          <h2 className="preview-title" id={titleId}>
            {title}
          </h2>
        </div>
        {shown.length > 0 && <div className="preview-meta">{shown}</div>}
        {facts.length > 0 && (
          <dl className="preview-facts" data-testid="preview-facts">
            {facts.map((f) => (
              <div key={f.key} className={`preview-fact preview-fact-${f.key}`}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  // Función de render (no componente): uno definido acá adentro se remontaría en cada render
  // y la edición en curso de un campo se perdería.
  function section(sid: string, title: string, count: number | undefined, children: React.ReactNode) {
    return (
      <details key={sid} className="preview-sec" open data-preview-section={sid}>
        <summary className="preview-sec-head">
          <svg className="preview-sec-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span className="preview-sec-title">{title}</span>
          {count !== undefined && <span className="preview-sec-count num">{count}</span>}
        </summary>
        <div className="preview-sec-body">{children}</div>
      </details>
    );
  }

  function renderStage() {
    if (!payload || type !== 'deal') return null;
    const p = payload as DealPayload;
    if (!stages.length) return null;
    return section(
      'stage',
      p.pipeline?.name ? `${t('deals.form.stage')} · ${p.pipeline.name}` : t('deals.form.stage'),
      undefined,
      <div className="preview-stage">
        <DealStagePanel key={p.deal.stage_id} variant="select" dealId={p.deal.id} stages={stages} currentStageId={p.deal.stage_id} onMoved={reload} />
      </div>,
    );
  }

  // Opciones para asociar: las primeras al abrir el buscador y el resto buscando (las rutas ya
  // aplican la visibilidad por owner: no aparece nada que la persona no ve).
  const loaders = useMemo(() => {
    const list = (plural: 'contacts' | 'companies' | 'deals') => async (): Promise<AssociationOption[]> => {
      const res = await fetch(`/api/crm/${plural}?pageSize=20`).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { rows?: Array<Record<string, unknown>> } | null) : null;
      return (data?.rows ?? []).map((r) => optionOf(plural, r));
    };
    // El buscador de asociar (hasta 20 resultados, solo lo que la persona ve), no el de Cmd+K (5 por tipo).
    const find = (plural: 'contacts' | 'companies' | 'deals') => (q: string): Promise<AssociationOption[]> =>
      searchAssociable(plural, q).then((hits) => hits.map((h) => ({ id: h.id, value: h.meta ? `${h.name} · ${h.meta}` : h.name })));
    return {
      contacts: { load: list('contacts'), search: find('contacts') },
      companies: { load: list('companies'), search: find('companies') },
      deals: { load: list('deals'), search: find('deals') },
    };
  }, []);

  // Asociar y quitar por la ruta de asociaciones (verifica que la persona ve los dos registros).
  const ASSOC_TYPE = { contacts: 'contact', companies: 'company', deals: 'deal' } as const;
  async function linkRecords(method: 'POST' | 'DELETE', sid: 'contacts' | 'companies' | 'deals', otherId: string): Promise<{ error?: string } | void> {
    const res = await fetch('/api/crm/associations', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromType: type, fromId: id, toType: ASSOC_TYPE[sid], toId: otherId }),
    }).catch(() => null);
    if (res?.ok) return;
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    return { error: data?.error ?? 'generic' };
  }

  function assocCard(
    sid: 'contacts' | 'companies' | 'deals',
    title: string,
    records: Array<{ id: string; name: string; meta?: string }>,
    empty: string,
    addLabel: string,
  ) {
    return section(sid, title, records.length,
      <AssociationPanel
        records={records.map((r) => ({ ...r, href: `/app/crm/${sid}/${r.id}` }))}
        options={[]}
        onAssociate={(otherId) => linkRecords('POST', sid, otherId)}
        onRemove={(otherId) => linkRecords('DELETE', sid, otherId)}
        addLabel={addLabel}
        emptyLabel={empty}
        search={loaders[sid].search}
        loadOptions={loaders[sid].load}
        onChanged={() => void reload()}
        testId={`preview-assoc-${sid}`}
      />,
    );
  }

  /** Contacto o empresa del lead: uno solo, como en su ficha (las mismas server actions). */
  function leadRefCard(sid: 'contacts' | 'companies', l: PreviewLead) {
    const isContact = sid === 'contacts';
    const refId = isContact ? l.contact_id : l.company_id;
    const hidden = isContact ? l.contact_private : l.company_private;
    const name = isContact ? (l.contact_name ?? l.contact_email ?? '') : (l.company_name ?? '');
    const meta = isContact ? (l.contact_name ? l.contact_email ?? undefined : undefined) : (l.company_domain ?? undefined);
    const records = refId ? [{ id: refId, name, meta, href: `/app/crm/${sid}/${refId}` }] : [];
    return section(sid, t(isContact ? 'leads.summaryContact' : 'leads.summaryCompany'), records.length,
      <AssociationPanel
        records={records}
        options={[]}
        onAssociate={(otherId) => (isContact ? setLeadContact(id, otherId) : setLeadCompany(id, otherId))}
        onRemove={() => (isContact ? clearLeadContact(id) : clearLeadCompany(id))}
        addLabel={t(isContact ? 'previewActions.addContact' : 'previewActions.addCompany')}
        emptyLabel={hidden ? t('common.privateRecord') : t('leads.none')}
        // Un lead tiene un contacto y una empresa: con uno puesto (o uno privado), no se agrega otro.
        search={refId || hidden ? undefined : loaders[sid].search}
        loadOptions={refId || hidden ? undefined : loaders[sid].load}
        onChanged={() => void reload()}
        testId={`preview-assoc-${sid}`}
      />,
    );
  }

  function renderAssociation(sid: string): React.ReactNode {
    if (!payload) return null;
    if (type === 'lead') {
      const l = payload as PreviewLead;
      if (sid === 'contacts' || sid === 'companies') return leadRefCard(sid, l);
      if (sid === 'deals') {
        return section('deals', t('leads.summaryDeal'), undefined,
          l.deal_id ? (
            <p className="preview-lead-deal">
              <Link href={`/app/crm/deals/${l.deal_id}`}>{l.deal_name}</Link>
            </p>
          ) : (
            <p className="muted preview-empty">{l.deal_private ? t('common.privateRecord') : t('leads.none')}</p>
          ),
        );
      }
      return null;
    }
    const contactItem = (c: PreviewContact) => ({ id: c.id, name: contactName(c), meta: c.email || undefined });
    const companyItem = (c: PreviewCompany) => ({ id: c.id, name: c.name, meta: c.domain || undefined });
    if (type === 'contact') {
      const p = payload as ContactPayload;
      if (sid === 'companies') {
        const companies = p.companies?.length ? p.companies : p.company ? [p.company] : [];
        return assocCard('companies', t('deals.detail.companies'), companies.map(companyItem), t('deals.detail.noCompany'), t('previewActions.addCompany'));
      }
      if (sid === 'deals') {
        return assocCard('deals', t('contacts.detail.deals'),
          p.deals.map((d) => ({ id: d.id, name: d.name, meta: [d.stage_name, formatMoney(d.amount, d.currency, locale)].filter(Boolean).join(' · ') })),
          t('contacts.detail.noDeals'), t('previewActions.addDeal'));
      }
      return null;
    }
    if (type === 'company') {
      const p = payload as CompanyPayload;
      if (sid === 'contacts') {
        return assocCard('contacts', t('companies.detail.contacts'), p.contacts.map(contactItem), t('companies.detail.noContacts'), t('previewActions.addContact'));
      }
      if (sid === 'deals') {
        return assocCard('deals', t('companies.detail.deals'),
          p.deals.map((d) => ({ id: d.id, name: d.name, meta: formatMoney(d.amount, d.currency, locale) })),
          t('companies.detail.noDeals'), t('previewActions.addDeal'));
      }
      return null;
    }
    const p = payload as DealPayload;
    if (sid === 'contacts') {
      return assocCard('contacts', t('deals.detail.contacts'), p.contacts.map(contactItem), t('deals.detail.noContacts'), t('previewActions.addContact'));
    }
    if (sid === 'companies') {
      const companies = p.companies?.length ? p.companies : p.company ? [p.company] : [];
      return assocCard('companies', t('deals.detail.companies'), companies.map(companyItem), t('deals.detail.noCompany'), t('previewActions.addCompany'));
    }
    return null;
  }

  const aboutTitle =
    type === 'contact'
      ? t('contacts.detail.aboutSection')
      : type === 'company'
        ? t('companies.detail.aboutSection')
        : type === 'lead'
          ? t('leads.aboutSection')
          : t('deals.detail.aboutSection');

  function renderAbout() {
    if (!payload) return null;
    // Propias del objeto más las personalizadas configuradas acá (las demás van en su tarjeta: ninguna se repite).
    const configured = new Set(layout.properties);
    const fields = [...standardFields(), ...customFields.filter((f) => configured.has(f.key))];
    // Lo configurado en Ajustes, en ese orden; "Ver todas" abre el resto. Sin nada configurado
    // (o todo oculto para quien mira), lo de por defecto.
    let keys = layout.properties.filter((k) => fields.some((f) => f.key === k));
    if (!keys.length) keys = defaultPreviewLayout(PLURAL[type]).properties.filter((k) => fields.some((f) => f.key === k));
    return section('about', aboutTitle, undefined, (
      <PropertiesPanel
        endpoint={endpoint}
        fields={fields}
        custom={custom}
        compactKeys={keys}
        viewAllLabel={t('preview.allProps')}
        optimistic
        onSaved={() => void reload()}
        savedCustomRef={savedCustom}
      />
    ));
  }

  function renderCustom() {
    // Propiedades personalizadas agrupadas, sin las que ya están a la vista en "Acerca de".
    const inAbout = new Set(layout.properties.filter((k) => customLayoutName(k)));
    const rest = customFields.filter((f) => !inAbout.has(f.key));
    const restDefs = defs.filter((d) => !inAbout.has(`custom.${d.name}`));
    const customSections = customFieldSections(restDefs, rest, t('preview.customProps'));
    if (!customSections.length) return null;
    return section('custom', t('preview.customProps'), undefined, (
      <PropertiesPanel
        endpoint={endpoint}
        fields={rest}
        custom={custom}
        sections={customSections.length > 1 || customSections[0].title !== t('preview.customProps') ? customSections : undefined}
        optimistic
        onSaved={() => void reload()}
        savedCustomRef={savedCustom}
      />
    ));
  }

  function renderSection(sid: string): React.ReactNode {
    if (sid === 'stage') return renderStage();
    if (sid === 'custom') return renderCustom();
    if (sid === 'activity') {
      return section('activity', t('previewActions.recent'), undefined,
        <RecentActivity items={recent} loading={recentLoading} locale={locale} href={`${detailHref}?tab=activity`} />,
      );
    }
    return renderAssociation(sid);
  }

  let emailTo = '';
  if (payload && type === 'contact') emailTo = (payload as ContactPayload).contact.email || '';
  else if (payload && type === 'deal') emailTo = (payload as DealPayload).contacts.find((c) => c.email)?.email ?? '';
  else if (payload && type === 'company') emailTo = (payload as CompanyPayload).contacts.find((c) => c.email)?.email ?? '';
  else if (payload && type === 'lead') emailTo = (payload as PreviewLead).contact_email ?? '';

  return (
    <div className="preview-overlay" onClick={onClose} role="presentation">
      <aside
        ref={panelRef}
        className="preview-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={payload ? titleId : undefined}
        aria-label={payload ? undefined : t(`preview.kind.${type}`)}
        data-testid="record-preview"
      >
        <div className="preview-head">
          <span className="preview-kind">{t(`preview.kind.${type}`)}</span>
          <span className="preview-head-tools">
            {nav}
            {isAdmin && (
              <Link
                href={`/app/crm/settings?tab=data&object=${plural}#preview-layout`}
                className="btn btn-ghost btn-sm preview-customize"
                data-testid="preview-customize"
              >
                {t('layouts.customize')}
              </Link>
            )}
            <button ref={closeRef} type="button" className="icon-btn preview-close" onClick={onClose} aria-label={t('common.close')}>
              <CrmIcon name="x" />
            </button>
          </span>
        </div>

        <div className="preview-body">
          {loading && (
            <div className="preview-loading" role="status" aria-label={t('record.loading')}>
              <span className="preview-skel preview-skel-title" />
              <span className="preview-skel" />
              <span className="preview-skel preview-skel-short" />
            </div>
          )}
          {gone && (
            <div className="preview-error" role="alert" data-testid="preview-gone">
              <p>{t('recordNav.gone')}</p>
            </div>
          )}
          {!gone && !loading && error && (
            <div className="preview-error" role="alert">
              <p>{t('preview.loadError')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>
                {t('preview.retry')}
              </button>
            </div>
          )}
          {!gone && !loading && !error && payload && (
            <>
              {renderHeader()}
              <PreviewActions
                type={type}
                id={id}
                locale={locale}
                emailTo={emailTo}
                meetingName={prefillName}
                meetingEmail={prefillEmail}
                onLogged={() => {
                  if (showRecent) void loadRecent();
                }}
              />
              {renderAbout()}
              {layout.sections.map((sid) => (
                <Fragment key={sid}>{renderSection(sid)}</Fragment>
              ))}
            </>
          )}
        </div>

        <div className="preview-foot">
          <Link href={detailHref} className="btn btn-primary preview-open" data-testid="preview-open-record">
            {t('preview.openRecord')}
          </Link>
        </div>
      </aside>
    </div>
  );
}

/** Opción de asociación a partir de una fila de lista o de búsqueda. */
function optionOf(plural: 'contacts' | 'companies' | 'deals', r: Record<string, unknown>): AssociationOption {
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  if (plural === 'contacts') {
    const name = `${str('first_name')} ${str('last_name')}`.trim() || str('email') || '—';
    return { id: str('id'), value: str('email') && name !== str('email') ? `${name} · ${str('email')}` : name };
  }
  return { id: str('id'), value: str('name') || '—' };
}
