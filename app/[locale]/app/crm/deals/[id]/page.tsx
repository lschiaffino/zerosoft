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
  setDealCompanyPrimary,
  associateContactToDeal,
  removeContactFromDeal,
} from '@/components/crm/associationActions';
import DealStagePanel from '@/components/crm/DealStagePanel';
import LineItemsPanel from '@/components/crm/LineItemsPanel';
import DealQuotesPanel from '@/components/crm/DealQuotesPanel';
import { listLineItems, listProducts, listQuotes } from '@/lib/crm-products';
import BookMeetingMenu from '@/components/crm/BookMeetingMenu';
import { listEventTypes } from '@/lib/calendar';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import { getEmailSettings, listEmailTemplates, listEmailThreads, mergeTimelineWithThreads } from '@/lib/crm-email';
import { aiEnabled } from '@/lib/ai';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';
import { getCurrencyContext } from '@/lib/crm-currency';
import { convertAmount, formatMoney } from '@/lib/crm-money';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import RecordTags from '@/components/crm/RecordTags';

export const dynamic = 'force-dynamic';

interface DealDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function DealDetailPage(props: DealDetailPageProps) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const detail = await getDeal(user.id, id);
  if (!detail) notFound();
  const { deal, stage, pipeline, contacts, company, companies: dealCompanies } = detail;
  const [currencyCtx, allTags, recordTags] = await Promise.all([
    getCurrencyContext(user.id),
    listTags(user.id),
    tagsForRecords(user.id, 'deal', [id]),
  ]);
  // Monto en la moneda base del workspace (solo si es otra moneda y hay tipo de cambio).
  const baseAmount =
    deal.currency.toUpperCase() !== currencyCtx.base
      ? convertAmount(deal.amount, deal.currency, currencyCtx.base, currencyCtx)
      : null;

  const teamMembers = user.team?.id ? await listMembers(user.team.id) : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));

  const activities = await listTimeline(user.id, { dealId: id, limit: 100 });
  const timeline = mergeTimelineWithThreads(activities, await listEmailThreads(user.id, { dealId: id, limit: 100 }));
  const emailTemplates = await listEmailTemplates(user.id);
  const emailSettings = await getEmailSettings(user.id);
  const nextTask = await nextTaskFor(user.id, { dealId: id });

  // Line items y quotes (columna central).
  const [lineSummary, activeProducts, dealQuotes] = await Promise.all([
    listLineItems(user.id, id),
    listProducts(user.id, { active: true, pageSize: 200 }),
    listQuotes(user.id, { dealId: id, pageSize: 50 }),
  ]);
  const realPerson = user.actingUser ?? user;

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
    {
      key: 'amount',
      label: t('deals.form.amount'),
      type: 'number',
      value: String(deal.amount),
      display: fmtAmount(deal.amount, deal.currency),
    },
    { key: 'currency', label: t('deals.form.currency'), type: 'text', value: deal.currency },
    {
      key: 'closeDate',
      label: t('deals.form.closeDate'),
      type: 'date',
      value: deal.close_date ?? '',
      display: deal.close_date
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(`${deal.close_date.slice(0, 10)}T00:00:00Z`),
          )
        : undefined,
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
    path: `/book/${user.handle}/${et.slug}`,
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
          {baseAmount !== null && (
            <span className="detail-meta-item muted mono" title={t('currency.convertedHint', { base: currencyCtx.base })}>
              ≈ {formatMoney(baseAmount, currencyCtx.base, locale)}
            </span>
          )}
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
        <RecordTags
          entity="deal"
          recordId={deal.id}
          tags={recordTags.get(deal.id) ?? []}
          allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
        />
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

          <section className="panel" id="line-items">
            <div className="panel-head">
              <h2 className="section-label">{t('lineItems.title')}</h2>
              {lineSummary && lineSummary.items.length > 0 && (
                <span className="panel-more">{lineSummary.items.length}</span>
              )}
            </div>
            <LineItemsPanel
              dealId={deal.id}
              currency={deal.currency}
              locale={locale}
              items={(lineSummary?.items ?? []).map((i) => ({
                id: i.id,
                product_id: i.product_id,
                name: i.name,
                sku: i.sku,
                quantity: i.quantity,
                unit_price: i.unit_price,
                discount_pct: i.discount_pct,
                tax_pct: i.tax_pct,
                recurring: i.recurring,
                net: i.net,
                total: i.total,
                updated_at: i.updated_at,
              }))}
              totals={lineSummary?.totals ?? { subtotal: 0, discount: 0, net: 0, tax: 0, total: 0 }}
              amountOverride={!!deal.amount_override}
              dealAmount={deal.amount}
              products={activeProducts.rows.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price,
                currency: p.currency,
                recurring: p.recurring,
              }))}
            />
          </section>

          <section className="panel" id="quotes">
            <div className="panel-head">
              <h2 className="section-label">{t('quotes.title')}</h2>
              {dealQuotes.total > 0 && <span className="panel-more">{dealQuotes.total}</span>}
            </div>
            <DealQuotesPanel
              dealId={deal.id}
              dealName={deal.name}
              locale={locale}
              hasLineItems={(lineSummary?.items.length ?? 0) > 0}
              quotes={dealQuotes.rows.map((q) => ({
                id: q.id,
                number: q.number,
                status: q.status,
                total: q.total,
                currency: q.currency,
                title: q.title,
              }))}
              sender={{
                name: realPerson.name ?? '',
                email: realPerson.email,
                company: user.team?.name ?? '',
              }}
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
              defaultEmail={primaryContact?.email ?? ''}
              emailTools={{
                templates: emailTemplates.map((x) => ({ id: x.id, kind: x.kind, name: x.name, subject: x.subject, body: x.body })),
                aiEnabled: aiEnabled(),
                trackingDefault: emailSettings.trackingEnabled,
                contactId: primaryContact?.id,
                dealId: deal.id,
              }}
            />
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
            <AssociationPanel
              title={t('deals.detail.companies')}
              count={dealCompanies.length}
              records={dealCompanies.map((c) => ({
                id: c.id,
                name: c.name,
                href: `/app/crm/companies/${c.id}`,
                meta: c.domain || undefined,
                primary: !!c.is_primary,
              }))}
              options={allCompanies
                .filter((c) => !dealCompanies.some((dc) => dc.id === c.id))
                .map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateCompanyToDeal.bind(null, deal.id)}
              onRemove={removeCompanyFromDealByDeal.bind(null, deal.id)}
              onSetPrimary={setDealCompanyPrimary.bind(null, deal.id)}
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
