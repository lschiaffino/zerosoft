import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getCompany, LIFECYCLE_STAGES, listCustomFields, listTimeline, parseCustom } from '@/lib/crm';
import DangerDelete from '@/components/crm/DangerDelete';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';

export const dynamic = 'force-dynamic';

interface CompanyDetailPageProps {
  params: { locale: string; id: string };
}

export default async function CompanyDetailPage({ params: { locale, id } }: CompanyDetailPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const detail = await getCompany(user.id, id);
  if (!detail) notFound();
  const { company, contacts, deals } = detail;

  const timeline = await listTimeline(user.id, { companyId: id, limit: 100 });

  // Nombres de stage para los deals relacionados.
  const stageRows = (await getDb().prepare('SELECT id, name FROM crm_stages').all()) as Array<{
    id: string;
    name: string;
  }>;
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

  const fmtAmount = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const custom = parseCustom(company.custom);
  const fields: PropField[] = [
    { key: 'name', label: t('companies.form.name'), type: 'text', value: company.name },
    { key: 'domain', label: t('companies.form.domain'), type: 'text', value: company.domain },
    { key: 'industry', label: t('companies.form.industry'), type: 'text', value: company.industry },
    {
      key: 'employees',
      label: t('companies.form.employees'),
      type: 'number',
      value: company.employees === null ? '' : String(company.employees),
    },
    { key: 'phone', label: t('companies.form.phone'), type: 'text', value: company.phone },
    { key: 'website', label: t('companies.form.website'), type: 'text', value: company.website },
    { key: 'city', label: t('companies.form.city'), type: 'text', value: company.city },
    { key: 'country', label: t('companies.form.country'), type: 'text', value: company.country },
    {
      key: 'lifecycleStage',
      label: t('companies.form.lifecycle'),
      type: 'select',
      value: company.lifecycle_stage,
      options: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    },
    ...customPropFields(await listCustomFields(user.id, 'companies'), custom, {
      yes: t('common.yes'),
      no: t('common.no'),
    }),
  ];

  const confirmValue = company.domain || company.name;

  return (
    <div className="app-page">
      <div>
        <Link href="/app/crm/companies" className="back-link">
          {t('companies.detail.back')}
        </Link>
      </div>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{company.name}</h1>
          <span className={`badge stage-${company.lifecycle_stage}`}>
            {lifecycleLabel(company.lifecycle_stage)}
          </span>
        </div>
        <div className="detail-meta">
          {company.domain && (
            <a
              className="detail-meta-item cell-email"
              href={`https://${company.domain}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {company.domain} ↗
            </a>
          )}
          {company.industry && <span className="detail-meta-item muted">{company.industry}</span>}
          {company.employees !== null && (
            <span className="detail-meta-item muted">
              {t('companies.table.employees')}: {company.employees}
            </span>
          )}
          {(company.city || company.country) && (
            <span className="detail-meta-item muted">
              {[company.city, company.country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </header>

      <div className="detail-grid-3">
        <div className="detail-col">
          <section className="panel">
            <h2 className="section-label">{t('companies.detail.properties')}</h2>
            <PropertiesPanel endpoint={`/api/crm/companies/${company.id}`} fields={fields} custom={custom} />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <h2 className="section-label">{t('companies.detail.timeline')}</h2>
            <Timeline
              recordType="company"
              recordId={company.id}
              items={timeline}
              emptyLabel={t('companies.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-label">{t('companies.detail.contacts')}</h2>
              <span className="panel-more">{contacts.length}</span>
            </div>
            {contacts.length === 0 ? (
              <p className="muted">{t('companies.detail.noContacts')}</p>
            ) : (
              <ul className="recent-list">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/crm/contacts/${c.id}`} className="recent-row crm-row">
                      <span className="recent-name">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}
                      </span>
                      <span className="muted recent-meta">{c.email || '—'}</span>
                      <span className={`badge stage-${c.lifecycle_stage}`}>
                        {lifecycleLabel(c.lifecycle_stage)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="section-label">{t('companies.detail.deals')}</h2>
              <span className="panel-more">{deals.length}</span>
            </div>
            {deals.length === 0 ? (
              <p className="muted">{t('companies.detail.noDeals')}</p>
            ) : (
              <ul className="recent-list">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/crm/deals/${d.id}`} className="recent-row crm-row">
                      <span className="recent-name">{d.name}</span>
                      <span className="muted recent-meta">{stageName.get(d.stage_id) ?? '—'}</span>
                      <span className="mono recent-date">{fmtAmount(d.amount, d.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel danger-panel">
            <h2 className="section-label">{t('companies.detail.dangerZone')}</h2>
            <DangerDelete
              endpoint={`/api/crm/companies/${company.id}`}
              confirmToken={confirmValue}
              redirectTo="/app/crm/companies"
              title={t('companies.detail.deleteTitle')}
              desc={t('companies.detail.deleteDesc')}
              buttonLabel={t('companies.detail.deleteButton')}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
