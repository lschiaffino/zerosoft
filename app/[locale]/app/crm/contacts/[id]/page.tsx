import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  getContact,
  listCompanies,
  listCustomFields,
  listTimeline,
  parseCustom,
} from '@/lib/crm';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import DuplicatesPanel from '@/components/crm/DuplicatesPanel';
import DangerDelete from '@/components/crm/DangerDelete';

export const dynamic = 'force-dynamic';

function money(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export default async function ContactDetailPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const detail = getContact(user.id, id);
  if (!detail) notFound();

  const { contact, company, deals, lists } = detail;
  const timeline = listTimeline(user.id, { contactId: id, limit: 100 });
  const companies = listCompanies(user.id, { pageSize: 100, sort: 'name' }).rows;

  const name = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || '—';

  const custom = parseCustom(contact.custom);
  const fields: PropField[] = [
    { key: 'firstName', label: t('contacts.form.firstName'), type: 'text', value: contact.first_name },
    { key: 'lastName', label: t('contacts.form.lastName'), type: 'text', value: contact.last_name },
    { key: 'email', label: t('contacts.form.email'), type: 'text', value: contact.email },
    { key: 'phone', label: t('contacts.form.phone'), type: 'text', value: contact.phone },
    { key: 'jobTitle', label: t('contacts.form.jobTitle'), type: 'text', value: contact.job_title },
    { key: 'website', label: t('contacts.form.website'), type: 'text', value: contact.website },
    { key: 'city', label: t('contacts.form.city'), type: 'text', value: contact.city },
    { key: 'country', label: t('contacts.form.country'), type: 'text', value: contact.country },
    {
      key: 'lifecycleStage',
      label: t('contacts.form.lifecycle'),
      type: 'select',
      value: contact.lifecycle_stage,
      options: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    },
    {
      key: 'leadStatus',
      label: t('contacts.form.leadStatus'),
      type: 'select',
      value: contact.lead_status,
      options: LEAD_STATUSES.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) })),
    },
    {
      key: 'source',
      label: t('contacts.form.source'),
      type: 'select',
      value: contact.source,
      // La API no acepta source vacío: solo se muestra '—' si ya está vacío (no-op).
      options: [
        ...(contact.source === '' ? [{ value: '', label: '—' }] : []),
        ...SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
      ],
    },
    {
      key: 'companyId',
      label: t('contacts.form.company'),
      type: 'select',
      value: contact.company_id ?? '',
      options: companies.map((c) => ({ value: c.id, label: c.name })),
      nullOption: true,
    },
    ...customPropFields(listCustomFields(user.id, 'contacts'), custom, {
      yes: t('common.yes'),
      no: t('common.no'),
    }),
  ];

  return (
    <div className="app-page">
      <Link href="/app/crm/contacts" className="mono back-link">
        {t('contacts.detail.back')}
      </Link>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{name}</h1>
          {contact.lifecycle_stage && (
            <span className={`badge stage-${contact.lifecycle_stage}`}>
              {t(`enums.lifecycle.${contact.lifecycle_stage}`)}
            </span>
          )}
          {contact.lead_status && (
            <span className="badge">{t(`enums.leadStatus.${contact.lead_status}`)}</span>
          )}
        </div>
        <div className="detail-meta">
          {company && (
            <Link href={`/app/crm/companies/${company.id}`} className="detail-meta-item">
              {company.name}
            </Link>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="detail-meta-item muted">
              {contact.email}
            </a>
          )}
          {contact.job_title && <span className="detail-meta-item muted">{contact.job_title}</span>}
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-col">
          <section className="panel">
            <p className="section-label">{t('contacts.detail.properties')}</p>
            <PropertiesPanel endpoint={`/api/crm/contacts/${contact.id}`} fields={fields} custom={custom} />
          </section>

          <section className="panel">
            <p className="section-label">{t('contacts.detail.lists')}</p>
            {lists.length === 0 ? (
              <p className="muted">{t('contacts.detail.noLists')}</p>
            ) : (
              <div className="filter-chips">
                {lists.map((l) => (
                  <Link key={l.id} href={`/app/crm/lists/${l.id}`} className="chip">
                    {l.name}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel danger-panel">
            <p className="section-label">{t('contacts.detail.dangerZone')}</p>
            <DangerDelete
              endpoint={`/api/crm/contacts/${contact.id}`}
              confirmToken={contact.email || name}
              redirectTo="/app/crm/contacts"
              title={t('contacts.detail.deleteTitle')}
              desc={t('contacts.detail.deleteDesc')}
              buttonLabel={t('contacts.detail.deleteButton')}
            />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <p className="section-label">{t('contacts.detail.deals')}</p>
            {deals.length === 0 ? (
              <p className="muted">{t('contacts.detail.noDeals')}</p>
            ) : (
              <ul className="recent-list">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/crm/deals/${d.id}`} className="recent-row crm-row">
                      <span className="recent-name">{d.name}</span>
                      <span className="muted recent-meta">
                        {d.stage_name ?? ''}
                        {d.closed_at ? ` · ${t('deals.detail.closedAt')}` : ''}
                      </span>
                      <span className="mono recent-date">
                        {money(d.amount, d.currency, locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <p className="section-label">{t('contacts.detail.duplicates')}</p>
            <DuplicatesPanel contactId={contact.id} />
          </section>

          <section className="panel">
            <p className="section-label">{t('contacts.detail.timeline')}</p>
            <Timeline
              recordType="contact"
              recordId={contact.id}
              items={timeline}
              emptyLabel={t('contacts.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
