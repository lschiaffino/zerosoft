import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, listCustomFields, listTimeline, nextTaskFor, parseCustom, PRIORITIES, SOURCES } from '@/lib/crm';
import DangerDelete from '@/components/crm/DangerDelete';
import AssociationPanel from '@/components/crm/AssociationPanel';
import {
  associateCompanyToDeal,
  removeCompanyFromDealByDeal,
  associateContactToDeal,
  removeContactFromDeal,
} from '@/components/crm/associationActions';
import DealStagePanel from '@/components/crm/DealStagePanel';
import BookMeetingMenu from '@/components/crm/BookMeetingMenu';
import { listEventTypes } from '@/lib/calendar';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';

export const dynamic = 'force-dynamic';

interface DealDetailPageProps {
  params: { locale: string; id: string };
}

export default async function DealDetailPage({ params: { locale, id } }: DealDetailPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const detail = await getDeal(user.id, id);
  if (!detail) notFound();
  const { deal, stage, pipeline, contacts, company } = detail;

  const teamMembers = user.team?.id ? await listMembers(user.team.id) : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const timeline = await listTimeline(user.id, { dealId: id, limit: 100 });
  const nextTask = await nextTaskFor(user.id, { dealId: id });

  const stages = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
    .all(deal.pipeline_id)) as CrmStageRow[];

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

  const allCompanies = (await getDb()
    .prepare('SELECT id, name, domain FROM crm_companies WHERE user_id = ? ORDER BY name ASC LIMIT 200')
    .all(user.id)) as Array<{ id: string; name: string; domain: string }>;

  const fmtAmount = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const fmtDate = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`),
    );

  const priorityLabel = (PRIORITIES as readonly string[]).includes(deal.priority)
    ? t(`enums.priority.${deal.priority}`)
    : deal.priority;

  const custom = parseCustom(deal.custom);
  const customFieldDefs = await listCustomFields(user.id, 'deals');
  const customFields = customPropFields(customFieldDefs, custom, {
    yes: t('common.yes'),
    no: t('common.no'),
  });
  const fields: PropField[] = [
    { key: 'name', label: t('deals.form.name'), type: 'text', value: deal.name },
    { key: 'amount', label: t('deals.form.amount'), type: 'number', value: String(deal.amount) },
    { key: 'currency', label: t('deals.form.currency'), type: 'text', value: deal.currency },
    {
      key: 'closeDate',
      label: t('deals.form.closeDate'),
      type: 'date',
      value: deal.close_date ?? '',
      nullOption: true,
    },
    {
      key: 'priority',
      label: t('deals.form.priority'),
      type: 'select',
      value: deal.priority,
      options: PRIORITIES.map((v) => ({ value: v, label: t(`enums.priority.${v}`) })),
    },
    {
      key: 'source',
      label: t('deals.form.source'),
      type: 'select',
      value: deal.source,
      // La API no acepta source vacío: solo se muestra '—' si ya está vacío (no-op).
      options: [
        ...(deal.source === '' ? [{ value: '', label: '—' }] : []),
        ...SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
      ],
    },
    { key: 'description', label: t('deals.form.description'), type: 'text', value: deal.description },
    {
      key: 'ownerId',
      label: t('deals.form.owner'),
      type: 'select',
      value: deal.owner_id ?? user.id,
      options: ownerOptions,
    },
    ...customFields,
  ];

  const sections: PropSection[] = [
    {
      title: t('deals.detail.aboutSection'),
      keys: ['name', 'amount', 'currency', 'closeDate', 'priority', 'source', 'description'],
    },
    { title: t('deals.detail.ownershipSection'), keys: ['ownerId'] },
    ...(customFields.length
      ? [{ title: t('deals.detail.customFieldsSection'), keys: customFields.map((f) => f.key) }]
      : []),
  ];

  const contactChips = contacts.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    email: c.email,
  }));

  // Pre-fill del booking con el primer contacto asociado (si hay).
  const primaryContact = contacts[0];
  const meetingTypes = (await listEventTypes(user.id, { activeOnly: true })).map((et) => ({
    slug: et.slug,
    title: et.title,
    durationMin: et.duration_min,
  }));

  const associatedContactIds = new Set(contacts.map((c) => c.id));

  const historyFields: Record<string, string> = {
    name: t('deals.form.name'),
    amount: t('deals.form.amount'),
    currency: t('deals.form.currency'),
    close_date: t('deals.form.closeDate'),
    priority: t('deals.form.priority'),
    source: t('deals.form.source'),
    description: t('deals.form.description'),
    lost_reason: t('deals.detail.lostReason'),
    stage: t('deals.form.stage'),
    owner_id: t('deals.form.owner'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    priority: Object.fromEntries(PRIORITIES.map((v) => [v, t(`enums.priority.${v}`)])),
    source: Object.fromEntries(SOURCES.map((v) => [v, t(`enums.source.${v}`)])),
  };

  return (
    <div className="app-page">
      <div>
        <Link href="/app/crm/deals" className="back-link">
          {t('deals.detail.back')}
        </Link>
      </div>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{deal.name}</h1>
          {stage && (
            <span className={`badge${stage.is_won ? ' stage-customer' : stage.is_lost ? ' task-overdue' : ''}`}>
              {stage.name}
            </span>
          )}
          <span className={`badge prio-${deal.priority}`}>{priorityLabel}</span>
        </div>
        <div className="detail-meta">
          <span className="detail-amount">{fmtAmount(deal.amount, deal.currency)}</span>
          {pipeline && <span className="detail-meta-item muted">{pipeline.name}</span>}
          {company && (
            <Link href={`/app/crm/companies/${company.id}`} className="detail-meta-item cell-email">
              {company.name}
            </Link>
          )}
          {deal.closed_at && (
            <span className="detail-meta-item muted">
              {t('deals.detail.closedAt')}: {fmtDate(deal.closed_at)}
            </span>
          )}
          {deal.lost_reason && (
            <span className="detail-meta-item muted">
              {t('deals.detail.lostReason')}: {deal.lost_reason}
            </span>
          )}
        </div>
        <div className="detail-actions">
          <BookMeetingMenu
            eventTypes={meetingTypes}
            name={
              primaryContact
                ? [primaryContact.first_name, primaryContact.last_name].filter(Boolean).join(' ') || undefined
                : undefined
            }
            email={primaryContact?.email || undefined}
            locale={locale}
          />
        </div>
      </header>

      <div className="detail-grid-3">
        <div className="detail-col">
          <section className="panel" id="properties">
            <h2 className="section-label">{t('deals.detail.properties')}</h2>
            <PropertiesPanel
              endpoint={`/api/crm/deals/${deal.id}`}
              fields={fields}
              custom={custom}
              sections={sections}
              compactKeys={['name', 'amount', 'priority', 'closeDate', 'ownerId']}
              viewAllLabel={t('deals.detail.viewAllProperties')}
            />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <h2 className="section-label">{t('deals.table.stage')}</h2>
            <DealStagePanel
              dealId={deal.id}
              stages={stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost }))}
              currentStageId={deal.stage_id}
            />
          </section>

          <section className="panel">
            <h2 className="section-label">{t('deals.detail.timeline')}</h2>
            <NextTaskBanner
              task={nextTask ? { id: nextTask.id, subject: nextTask.subject, due_at: nextTask.due_at } : null}
              locale={locale}
            />
            <Timeline
              recordType="deal"
              recordId={deal.id}
              items={timeline}
              emptyLabel={t('deals.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
            <AssociationPanel
              title={t('deals.detail.company')}
              records={
                company
                  ? [
                      {
                        id: company.id,
                        name: company.name,
                        href: `/app/crm/companies/${company.id}`,
                        meta: company.domain || undefined,
                      },
                    ]
                  : []
              }
              options={allCompanies
                .filter((c) => c.id !== company?.id)
                .map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateCompanyToDeal.bind(null, deal.id)}
              onRemove={removeCompanyFromDealByDeal.bind(null, deal.id)}
              addLabel={t('assoc.pickCompany')}
              emptyLabel={t('deals.detail.noCompany')}
            />
          </section>

          <section className="panel">
            <AssociationPanel
              title={t('deals.detail.contacts')}
              count={contacts.length}
              records={contactChips.map((c) => ({
                id: c.id,
                name: c.name,
                href: `/app/crm/contacts/${c.id}`,
                meta: c.email || undefined,
              }))}
              options={allContacts
                .filter((c) => !associatedContactIds.has(c.id))
                .map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateContactToDeal.bind(null, deal.id)}
              onRemove={removeContactFromDeal.bind(null, deal.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('deals.detail.noContacts')}
            />
          </section>

          <HistoryPanel
            entity="deal"
            entityId={deal.id}
            locale={locale}
            labels={{
              title: t('history.title'),
              empty: t('history.empty'),
              fields: historyFields,
              values: historyValues,
            }}
            key={deal.updated_at}
          />

          <section className="panel danger-panel">
            <h2 className="section-label">{t('deals.detail.dangerZone')}</h2>
            <DangerDelete
              endpoint={`/api/crm/deals/${deal.id}`}
              confirmToken={deal.name}
              redirectTo="/app/crm/deals"
              title={t('deals.detail.deleteTitle')}
              desc={t('deals.detail.deleteDesc')}
              buttonLabel={t('deals.detail.deleteButton')}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
