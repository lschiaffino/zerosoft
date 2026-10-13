import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { listEmailThreads, mergeTimelineWithThreads } from '@/lib/crm-email';
import { getCompany, LIFECYCLE_STAGES, listCustomFields, listTimeline, nextTaskFor, parseCustom } from '@/lib/crm';
import DangerDelete from '@/components/crm/DangerDelete';
import AssociationPanel from '@/components/crm/AssociationPanel';
import {
  associateContactToCompany,
  removeContactFromCompany,
  associateDealToCompany,
  removeDealFromCompany,
} from '@/components/crm/associationActions';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';

export const dynamic = 'force-dynamic';

interface CompanyDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function CompanyDetailPage(props: CompanyDetailPageProps) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const detail = await getCompany(user.id, id);
  if (!detail) notFound();
  const { company, contacts, deals } = detail;

  const teamMembers = user.team?.id ? await listMembers(user.team.id) : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const timeline = await listTimeline(user.id, { companyId: id, limit: 100 });
  const threads = await listEmailThreads(user.id, { companyId: id, limit: 100 });
  const timelineItems = mergeTimelineWithThreads(timeline, threads);
  const nextTask = await nextTaskFor(user.id, { companyId: id });

  // Nombres de stage para los deals relacionados.
  const stageRows = (await getDb().prepare('SELECT id, name FROM crm_stages').all()) as Array<{
    id: string;
    name: string;
  }>;
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));

  // Contacts del usuario para el selector de asociación (id + nombre alcanzan).
  const allContacts = (
    (await getDb()
      .prepare(
        `SELECT id, first_name, last_name, email FROM crm_contacts
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
      )
      .all(user.id)) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }>
  ).map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
  }));

  // Deals del usuario para el selector de asociación.
  const allDeals = (await getDb()
    .prepare('SELECT id, name FROM crm_deals WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(user.id)) as Array<{ id: string; name: string }>;

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

  const fmtAmount = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const custom = parseCustom(company.custom);
  const customFieldDefs = await listCustomFields(user.id, 'companies');
  const customFields = customPropFields(customFieldDefs, custom, {
    yes: t('common.yes'),
    no: t('common.no'),
  });
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
    {
      key: 'ownerId',
      label: t('companies.form.owner'),
      type: 'select',
      value: company.owner_id ?? user.id,
      options: ownerOptions,
    },
    ...customFields,
  ];

  const sections: PropSection[] = [
    {
      title: t('companies.detail.aboutSection'),
      keys: ['name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country'],
    },
    { title: t('companies.detail.lifecycleSection'), keys: ['lifecycleStage'] },
    { title: t('companies.detail.ownershipSection'), keys: ['ownerId'] },
    ...(customFields.length
      ? [{ title: t('companies.detail.customFieldsSection'), keys: customFields.map((f) => f.key) }]
      : []),
  ];

  const confirmValue = company.domain || company.name;

  const historyFields: Record<string, string> = {
    name: t('companies.form.name'),
    domain: t('companies.form.domain'),
    industry: t('companies.form.industry'),
    employees: t('companies.form.employees'),
    phone: t('companies.form.phone'),
    website: t('companies.form.website'),
    city: t('companies.form.city'),
    country: t('companies.form.country'),
    lifecycle_stage: t('companies.form.lifecycle'),
    owner_id: t('companies.form.owner'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    lifecycle_stage: Object.fromEntries(
      LIFECYCLE_STAGES.map((v) => [v, t(`enums.lifecycle.${v}`)]),
    ),
  };

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
          <section className="panel" id="properties">
            <h2 className="section-label">{t('companies.detail.properties')}</h2>
            <PropertiesPanel
              endpoint={`/api/crm/companies/${company.id}`}
              fields={fields}
              custom={custom}
              sections={sections}
              compactKeys={['name', 'domain', 'industry', 'lifecycleStage', 'ownerId']}
              viewAllLabel={t('companies.detail.viewAllProperties')}
            />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <h2 className="section-label">{t('companies.detail.timeline')}</h2>
            <NextTaskBanner
              task={nextTask ? { id: nextTask.id, subject: nextTask.subject, due_at: nextTask.due_at } : null}
              locale={locale}
            />
            <Timeline
              recordType="company"
              recordId={company.id}
              items={timelineItems}
              emptyLabel={t('companies.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
            <AssociationPanel
              title={t('companies.detail.contacts')}
              count={contacts.length}
              records={contacts.map((c) => ({
                id: c.id,
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
                href: `/app/crm/contacts/${c.id}`,
                meta: c.email || undefined,
              }))}
              options={allContacts
                .filter((c) => !contacts.some((cc) => cc.id === c.id))
                .map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateContactToCompany.bind(null, company.id)}
              onRemove={removeContactFromCompany.bind(null, company.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('companies.detail.noContacts')}
            />
            <Link href={`/app/crm/contacts/new?companyId=${company.id}`} className="kb-add">
              {t('companies.detail.newContact')}
            </Link>
          </section>

          <section className="panel">
            <AssociationPanel
              title={t('companies.detail.deals')}
              count={deals.length}
              records={deals.map((d) => ({
                id: d.id,
                name: d.name,
                href: `/app/crm/deals/${d.id}`,
                meta: `${stageName.get(d.stage_id) ?? '—'} · ${fmtAmount(d.amount, d.currency)}`,
              }))}
              options={allDeals
                .filter((d) => !deals.some((dd) => dd.id === d.id))
                .map((d) => ({ id: d.id, value: d.name }))}
              onAssociate={associateDealToCompany.bind(null, company.id)}
              onRemove={removeDealFromCompany.bind(null, company.id)}
              addLabel={t('assoc.pickDeal')}
              emptyLabel={t('companies.detail.noDeals')}
            />
            <Link href="/app/crm/deals/new?full=1" className="kb-add">
              {t('companies.detail.newDeal')}
            </Link>
          </section>

          <HistoryPanel
            entity="company"
            entityId={company.id}
            locale={locale}
            labels={{
              title: t('history.title'),
              empty: t('history.empty'),
              fields: historyFields,
              values: historyValues,
            }}
            key={company.updated_at}
          />

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
