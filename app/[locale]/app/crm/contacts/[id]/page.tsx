import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  PRIORITIES,
  SOURCES,
  getContact,
  listCompanies,
  listCustomFields,
  listExternalEmailItems,
  listPipelinesWithStages,
  listTimeline,
  mergeTimelineWithEmails,
  nextTaskFor,
  parseCustom,
} from '@/lib/crm';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import ContactAddDeal from '@/components/crm/ContactAddDeal';
import AssociateDeal from '@/components/crm/AssociateDeal';
import CompanyQuickCreate from '@/components/crm/CompanyQuickCreate';
import DuplicatesPanel from '@/components/crm/DuplicatesPanel';
import DangerDelete from '@/components/crm/DangerDelete';
import { listMembers } from '@/lib/teams';
import HistoryPanel from '@/components/crm/HistoryPanel';

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
  const detail = await getContact(user.id, id);
  if (!detail) notFound();

  const { contact, company, deals, lists } = detail;

  const teamMembers = user.team?.id ? await listMembers(user.team.id) : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const timeline = await listTimeline(user.id, { contactId: id, limit: 100 });
  const emailItems = await listExternalEmailItems(user.id, { contactId: id, limit: 50 });
  const timelineItems = mergeTimelineWithEmails(timeline, emailItems);
  const nextTask = await nextTaskFor(user.id, { contactId: id });
  const companies = (await listCompanies(user.id, { pageSize: 100, sort: 'name' })).rows;
  // Deals del usuario para el selector de asociación (id + nombre alcanzan).
  const allDeals = (await getDb()
    .prepare('SELECT id, name FROM crm_deals WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(user.id)) as Array<{ id: string; name: string }>;

  // Pipeline default + primer stage abierto (para crear deals desde el detalle).
  const pipelines = await listPipelinesWithStages(user.id);
  const defaultPipeline = pipelines[0];
  const firstOpenStage =
    defaultPipeline?.stages.find((s) => !s.is_won && !s.is_lost) ?? defaultPipeline?.stages[0];
  const priorities = PRIORITIES.map((value) => ({ value, label: t(`enums.priority.${value}`) }));
  const sourceOpts = SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }));

  const name = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || '—';

  const historyFields: Record<string, string> = {
    first_name: t('contacts.form.firstName'),
    last_name: t('contacts.form.lastName'),
    email: t('contacts.form.email'),
    phone: t('contacts.form.phone'),
    job_title: t('contacts.form.jobTitle'),
    website: t('contacts.form.website'),
    city: t('contacts.form.city'),
    country: t('contacts.form.country'),
    lifecycle_stage: t('contacts.form.lifecycle'),
    lead_status: t('contacts.form.leadStatus'),
    source: t('contacts.form.source'),
    company_id: t('contacts.form.company'),
    owner_id: t('contacts.form.owner'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    lifecycle_stage: Object.fromEntries(
      LIFECYCLE_STAGES.map((v) => [v, t(`enums.lifecycle.${v}`)]),
    ),
    lead_status: Object.fromEntries(LEAD_STATUSES.map((v) => [v, t(`enums.leadStatus.${v}`)])),
    source: Object.fromEntries(SOURCES.map((v) => [v, t(`enums.source.${v}`)])),
  };

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
    {
      key: 'ownerId',
      label: t('contacts.form.owner'),
      type: 'select',
      value: contact.owner_id ?? user.id,
      options: ownerOptions,
    },
    ...customPropFields(await listCustomFields(user.id, 'contacts'), custom, {
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

      <div className="detail-grid-3">
        <div className="detail-col">
          <section className="panel">
            <p className="section-label">{t('contacts.detail.properties')}</p>
            <PropertiesPanel endpoint={`/api/crm/contacts/${contact.id}`} fields={fields} custom={custom} />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <p className="section-label">{t('contacts.detail.timeline')}</p>
            <NextTaskBanner
              task={nextTask ? { id: nextTask.id, subject: nextTask.subject, due_at: nextTask.due_at } : null}
              locale={locale}
            />
            <Timeline
              recordType="contact"
              recordId={contact.id}
              items={timelineItems}
              emptyLabel={t('contacts.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
            <p className="section-label">{t('contacts.detail.company')}</p>
            {company ? (
              <ul className="recent-list">
                <li>
                  <Link href={`/app/crm/companies/${company.id}`} className="recent-row crm-row">
                    <span className="recent-name">{company.name}</span>
                    <span className="muted recent-meta">{company.domain || '—'}</span>
                  </Link>
                </li>
              </ul>
            ) : (
              <>
                <p className="muted">{t('contacts.detail.noCompany')}</p>
                <CompanyQuickCreate contactId={contact.id} />
              </>
            )}
          </section>

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
            {defaultPipeline && firstOpenStage && (
              <ContactAddDeal
                pipelineId={defaultPipeline.id}
                stageId={firstOpenStage.id}
                contactId={contact.id}
                priorities={priorities}
                sources={sourceOpts}
              />
            )}
            <AssociateDeal
              contactId={contact.id}
              deals={allDeals}
              excludeIds={deals.map((d) => d.id)}
            />
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

          <section className="panel">
            <p className="section-label">{t('contacts.detail.duplicates')}</p>
            <DuplicatesPanel contactId={contact.id} />
          </section>

          <HistoryPanel
            entity="contact"
            entityId={contact.id}
            locale={locale}
            labels={{
              title: t('history.title'),
              empty: t('history.empty'),
              fields: historyFields,
              values: historyValues,
            }}
            key={contact.updated_at}
          />

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
      </div>
    </div>
  );
}
