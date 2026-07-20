'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import BookMeetingMenu from '@/components/crm/BookMeetingMenu';

export type PreviewType = 'contact' | 'company' | 'deal';

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
  custom: string;
  created_at: string;
  updated_at: string;
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
  custom: string;
  created_at: string;
  updated_at: string;
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
  lost_reason: string;
  closed_at: string | null;
  custom: string;
  created_at: string;
  updated_at: string;
}

interface PreviewStage {
  id: string;
  name: string;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

interface PreviewPipeline {
  id: string;
  name: string;
}

interface TimelineItem {
  id: string;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email';
  subject: string;
  body: string;
  due_at: string | null;
  created_at: string;
  pinned: 0 | 1;
  external?: boolean;
}

interface ContactPayload {
  contact: PreviewContact;
  company: PreviewCompany | null;
  deals: Array<PreviewDeal & { stage_name: string; pipeline_name: string }>;
  lists: Array<{ id: string; name: string }>;
}

interface CompanyPayload {
  company: PreviewCompany;
  contacts: PreviewContact[];
  deals: PreviewDeal[];
}

interface DealPayload {
  deal: PreviewDeal;
  stage: PreviewStage | null;
  pipeline: PreviewPipeline | null;
  contacts: PreviewContact[];
  company: PreviewCompany | null;
}

type PreviewPayload = ContactPayload | CompanyPayload | DealPayload;

interface RecordPreviewProps {
  type: PreviewType;
  id: string;
  locale: string;
  onClose: () => void;
}

function isContactPayload(type: PreviewType, p: PreviewPayload): p is ContactPayload {
  return type === 'contact';
}

function isCompanyPayload(type: PreviewType, p: PreviewPayload): p is CompanyPayload {
  return type === 'company';
}

function isDealPayload(type: PreviewType, p: PreviewPayload): p is DealPayload {
  return type === 'deal';
}

function parseCustom(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`),
    );
  } catch {
    return iso;
  }
}

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function contactName(c: PreviewContact): string {
  return `${c.first_name} ${c.last_name}`.trim() || c.email || '—';
}

export default function RecordPreview({ type, id, locale, onClose }: RecordPreviewProps) {
  const t = useTranslations('crm');
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/crm/${type}s/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setLoading(false);
          if (!data) setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  // Cerrar con Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const detailHref = `/app/crm/${type}s/${id}`;

  // Pre-fill del booking: contacto directo, o primer contacto del deal.
  let prefillName: string | undefined;
  let prefillEmail: string | undefined;
  if (payload && isContactPayload(type, payload)) {
    const c = payload.contact;
    prefillName = `${c.first_name} ${c.last_name}`.trim() || undefined;
    prefillEmail = c.email || undefined;
  } else if (payload && isDealPayload(type, payload) && payload.contacts.length > 0) {
    const c = payload.contacts[0];
    prefillName = `${c.first_name} ${c.last_name}`.trim() || undefined;
    prefillEmail = c.email || undefined;
  }

  function renderHeader() {
    if (!payload) return null;
    if (isContactPayload(type, payload)) {
      const c = payload.contact;
      return (
        <div className="preview-header">
          <h2 className="preview-title">{contactName(c)}</h2>
          <div className="preview-badges">
            {c.lifecycle_stage && (
              <span className={`badge stage-${c.lifecycle_stage}`}>
                {t(`enums.lifecycle.${c.lifecycle_stage}`)}
              </span>
            )}
            {c.lead_status && <span className="badge">{t(`enums.leadStatus.${c.lead_status}`)}</span>}
          </div>
          <div className="preview-meta">
            {c.email && (
              <a href={`mailto:${c.email}`} className="preview-meta-item">
                {c.email}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="preview-meta-item">
                {c.phone}
              </a>
            )}
            {c.job_title && <span className="preview-meta-item muted">{c.job_title}</span>}
            {(c.city || c.country) && (
              <span className="preview-meta-item muted">{[c.city, c.country].filter(Boolean).join(', ')}</span>
            )}
          </div>
        </div>
      );
    }
    if (isCompanyPayload(type, payload)) {
      const c = payload.company;
      return (
        <div className="preview-header">
          <h2 className="preview-title">{c.name}</h2>
          <div className="preview-badges">
            {c.lifecycle_stage && (
              <span className={`badge stage-${c.lifecycle_stage}`}>
                {t(`enums.lifecycle.${c.lifecycle_stage}`)}
              </span>
            )}
          </div>
          <div className="preview-meta">
            {c.domain && (
              <a
                href={`https://${c.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="preview-meta-item"
              >
                {c.domain} ↗
              </a>
            )}
            {c.industry && <span className="preview-meta-item muted">{c.industry}</span>}
            {c.employees !== null && (
              <span className="preview-meta-item muted">{c.employees} employees</span>
            )}
            {(c.city || c.country) && (
              <span className="preview-meta-item muted">{[c.city, c.country].filter(Boolean).join(', ')}</span>
            )}
          </div>
        </div>
      );
    }
    if (isDealPayload(type, payload)) {
      const d = payload.deal;
      return (
        <div className="preview-header">
          <h2 className="preview-title">{d.name}</h2>
          <div className="preview-badges">
            {payload.stage && (
              <span
                className={`badge${payload.stage.is_won ? ' stage-customer' : payload.stage.is_lost ? ' task-overdue' : ''}`}
              >
                {payload.stage.name}
              </span>
            )}
            <span className={`badge prio-${d.priority}`}>{t(`enums.priority.${d.priority}`)}</span>
          </div>
          <div className="preview-meta">
            <span className="preview-meta-item">{formatMoney(d.amount, d.currency, locale)}</span>
            {payload.pipeline && (
              <span className="preview-meta-item muted">{payload.pipeline.name}</span>
            )}
            {d.close_date && (
              <span className="preview-meta-item muted">{formatDate(d.close_date, locale)}</span>
            )}
          </div>
        </div>
      );
    }
    return null;
  }

  function renderAssociations() {
    if (!payload) return null;
    if (isContactPayload(type, payload)) {
      return (
        <div className="preview-section">
          <h3 className="preview-section-title">{t('contacts.detail.deals')}</h3>
          {payload.deals.length === 0 ? (
            <p className="muted">{t('contacts.detail.noDeals')}</p>
          ) : (
            <ul className="preview-list">
              {payload.deals.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/crm/deals/${d.id}`} className="preview-list-name">
                    {d.name}
                  </Link>
                  <span className="preview-list-meta">
                    {d.stage_name} · {formatMoney(d.amount, d.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {payload.company && (
            <>
              <h3 className="preview-section-title">{t('contacts.detail.company')}</h3>
              <Link href={`/app/crm/companies/${payload.company.id}`} className="preview-list-name">
                {payload.company.name}
              </Link>
            </>
          )}
        </div>
      );
    }
    if (isCompanyPayload(type, payload)) {
      return (
        <div className="preview-section">
          <h3 className="preview-section-title">{t('companies.detail.contacts')}</h3>
          {payload.contacts.length === 0 ? (
            <p className="muted">{t('companies.detail.noContacts')}</p>
          ) : (
            <ul className="preview-list">
              {payload.contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/crm/contacts/${c.id}`} className="preview-list-name">
                    {contactName(c)}
                  </Link>
                  {c.email && <span className="preview-list-meta">{c.email}</span>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="preview-section-title">{t('companies.detail.deals')}</h3>
          {payload.deals.length === 0 ? (
            <p className="muted">{t('companies.detail.noDeals')}</p>
          ) : (
            <ul className="preview-list">
              {payload.deals.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/crm/deals/${d.id}`} className="preview-list-name">
                    {d.name}
                  </Link>
                  <span className="preview-list-meta">{formatMoney(d.amount, d.currency, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    if (isDealPayload(type, payload)) {
      return (
        <div className="preview-section">
          <h3 className="preview-section-title">{t('deals.detail.contacts')}</h3>
          {payload.contacts.length === 0 ? (
            <p className="muted">{t('deals.detail.noContacts')}</p>
          ) : (
            <ul className="preview-list">
              {payload.contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/crm/contacts/${c.id}`} className="preview-list-name">
                    {contactName(c)}
                  </Link>
                  {c.email && <span className="preview-list-meta">{c.email}</span>}
                </li>
              ))}
            </ul>
          )}
          {payload.company && (
            <>
              <h3 className="preview-section-title">{t('deals.detail.company')}</h3>
              <Link href={`/app/crm/companies/${payload.company.id}`} className="preview-list-name">
                {payload.company.name}
              </Link>
            </>
          )}
        </div>
      );
    }
    return null;
  }

  function renderTimeline() {
    if (!payload) return null;
    let items: TimelineItem[] = [];
    if (isContactPayload(type, payload)) {
      // El payload no incluye timeline directamente; lo obtenemos vía fetch aparte si hiciera falta.
      // Para mantener el preview ligero, mostramos deals + company arriba y dejamos timeline para el detalle.
      return null;
    }
    if (isCompanyPayload(type, payload)) return null;
    if (isDealPayload(type, payload)) return null;
    if (items.length === 0) return null;
    return (
      <div className="preview-section">
        <h3 className="preview-section-title">{t('history.title')}</h3>
        <ul className="preview-timeline">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span className="preview-tl-type">{t(`enums.activityType.${item.type}`)}</span>
              <span className="preview-tl-subject">{item.subject || '—'}</span>
              <span className="preview-tl-date">{formatDate(item.created_at, locale)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function renderProperties() {
    if (!payload) return null;
    const custom = parseCustom(
      isContactPayload(type, payload)
        ? payload.contact.custom
        : isCompanyPayload(type, payload)
          ? payload.company.custom
          : payload.deal.custom,
    );
    const entries: Array<{ label: string; value: string }> = [];
    if (isContactPayload(type, payload)) {
      const c = payload.contact;
      entries.push(
        { label: t('contacts.form.email'), value: c.email },
        { label: t('contacts.form.phone'), value: c.phone },
        { label: t('contacts.form.jobTitle'), value: c.job_title },
        { label: t('contacts.form.source'), value: c.source ? t(`enums.source.${c.source}`) : '' },
        { label: t('contacts.form.lifecycle'), value: t(`enums.lifecycle.${c.lifecycle_stage}`) },
        { label: t('contacts.form.leadStatus'), value: t(`enums.leadStatus.${c.lead_status}`) },
      );
    } else if (isCompanyPayload(type, payload)) {
      const c = payload.company;
      entries.push(
        { label: t('companies.form.domain'), value: c.domain },
        { label: t('companies.form.industry'), value: c.industry },
        { label: t('companies.form.phone'), value: c.phone },
        { label: t('companies.form.website'), value: c.website },
        { label: t('companies.form.lifecycle'), value: t(`enums.lifecycle.${c.lifecycle_stage}`) },
      );
    } else if (isDealPayload(type, payload)) {
      const d = payload.deal;
      entries.push(
        { label: t('deals.form.amount'), value: formatMoney(d.amount, d.currency, locale) },
        { label: t('deals.form.priority'), value: t(`enums.priority.${d.priority}`) },
        { label: t('deals.form.source'), value: d.source ? t(`enums.source.${d.source}`) : '' },
        { label: t('deals.form.closeDate'), value: d.close_date ? formatDate(d.close_date, locale) : '' },
        { label: t('deals.form.description'), value: d.description },
      );
    }

    const customEntries = Object.entries(custom).filter(([, v]) => v !== '' && v != null);

    return (
      <div className="preview-section">
        <h3 className="preview-section-title">{t('contacts.detail.properties')}</h3>
        <dl className="preview-props">
          {entries
            .filter((e) => e.value)
            .map((e) => (
              <div key={e.label} className="preview-prop-row">
                <dt className="preview-prop-label">{e.label}</dt>
                <dd className="preview-prop-value">{e.value}</dd>
              </div>
            ))}
          {customEntries.map(([k, v]) => (
            <div key={k} className="preview-prop-row">
              <dt className="preview-prop-label">{k}</dt>
              <dd className="preview-prop-value">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="preview-overlay" onClick={onClose} role="presentation">
      <aside
        className="preview-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('common.viewAll')}
      >
        <div className="preview-head">
          <button
            type="button"
            className="icon-btn preview-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="preview-body">
          {loading && <p className="muted">{t('common.saving')}</p>}
          {error && <p className="form-error">{t('errors.generic')}</p>}
          {!loading && !error && payload && (
            <>
              {renderHeader()}
              <div className="preview-actions">
                <Link href={detailHref} className="btn btn-solid btn-small">
                  {t('common.viewAll')}
                </Link>
                <BookMeetingMenu name={prefillName} email={prefillEmail} locale={locale} />
              </div>
              {renderAssociations()}
              {renderProperties()}
              {renderTimeline()}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
