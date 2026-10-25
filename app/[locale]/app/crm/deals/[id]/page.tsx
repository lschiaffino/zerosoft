import { getTranslations } from 'next-intl/server';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { listApprovals } from '@/lib/crm-approvals';
import { getSplits } from '@/lib/crm-splits';
import ApprovalBanner, { type ApprovalBannerItem } from '@/components/crm/ApprovalBanner';
import DealSplitsPanel from '@/components/crm/DealSplitsPanel';
import { canSeeOwner, scopeDealDetail, sessionScope, scopeAnd } from '@/lib/crm-visibility';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, listTimeline, nextTaskFor, parseCustom, PRIORITIES, SOURCES } from '@/lib/crm';
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
import PlaybookLauncher from '@/components/crm/PlaybookLauncher';
import { listEventTypes } from '@/lib/calendar';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import { withCallDetails } from '@/lib/crm-voice';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView, withActivityFiles } from '@/lib/crm-files';
import AiSummaryCard from '@/components/crm/AiSummaryCard';
import { crmAiAvailable, getRecordSummary, withCallSummaries, getDealScore } from '@/lib/crm-ai';
import DealInsightCard from '@/components/crm/DealInsightCard';
import { getEmailSettings, listEmailTemplates, listEmailThreads, mergeTimelineWithThreads } from '@/lib/crm-email';
import { aiEnabled } from '@/lib/ai';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';
import { getCurrencyContext } from '@/lib/crm-currency';
import { convertAmount, formatMoney } from '@/lib/crm-money';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import RecordTags from '@/components/crm/RecordTags';
import PageHeader from '@/components/ui/PageHeader';
import RecordTabs from '@/components/crm/RecordTabs';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';
import { parseDbUtc } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface DealDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DealDetailPage(props: DealDetailPageProps) {
  const [{ locale, id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tab = parseRecordTab(searchParams.tab);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const rawDetail = await getDeal(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.deal.owner_id, user.id)) notFound();
  const detail = scopeDealDetail(rawDetail, scope);
  const { deal, pipeline, contacts, company, companies: dealCompanies } = detail;
  const base = `/app/crm/deals/${deal.id}`;
  const [currencyCtx, allTags, recordTags, teamMembers, eventTypes, stages, approvals, splits] = await Promise.all([
    getCurrencyContext(user.id),
    listTags(user.id),
    tagsForRecords(user.id, 'deal', [id]),
    user.team?.id
      ? listMembers(user.team.id)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    listEventTypes(user.id, { activeOnly: true }),
    getDb()
      .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
      .all(deal.pipeline_id) as Promise<CrmStageRow[]>,
    listApprovals(user.id, { dealId: id, limit: 5 }),
    getSplits(user.id, id),
  ]);
  // Monto en la moneda base del workspace (solo si es otra moneda y hay tipo de cambio).
  const baseAmount =
    deal.currency.toUpperCase() !== currencyCtx.base
      ? convertAmount(deal.amount, deal.currency, currencyCtx.base, currencyCtx)
      : null;

  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const personName = (pid: string | null) => (pid ? ownerOptions.find((o) => o.value === pid)?.label ?? '' : '');
  // Aprobación a mostrar: la pendiente, o la última resuelta si sigue vigente
  // (aprobada sin usar o rechazada hace menos de 14 días).
  const recentCut = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const shownApproval = approvals.find(
    (a) =>
      a.status === 'pending' ||
      (a.status === 'approved' && !a.consumed_at) ||
      (a.status === 'rejected' && (a.decided_at ?? '') >= recentCut),
  );
  const fmtWhen = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(iso));
  const approvalItem: ApprovalBannerItem | null = shownApproval
    ? {
        id: shownApproval.id,
        status: shownApproval.status,
        stageName: shownApproval.stage_name,
        requestedBy: shownApproval.requested_by,
        requestedByName: personName(shownApproval.requested_by),
        approverIds: shownApproval.approvers,
        approverNames: shownApproval.approvers.map(personName).filter(Boolean).join(', '),
        note: shownApproval.note,
        decidedByName: personName(shownApproval.decided_by),
        decisionNote: shownApproval.decision_note,
        when: fmtWhen(shownApproval.status === 'pending' ? shownApproval.created_at : (shownApproval.decided_at ?? shownApproval.updated_at)),
        consumed: !!shownApproval.consumed_at,
      }
    : null;
  const ownerLabel = ownerOptions.find((o) => o.value === (deal.owner_id ?? user.id))?.label ?? '—';

  const fmtAmount = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const fmtDate = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      parseDbUtc(iso),
    );
  const closeDateLabel = deal.close_date
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${deal.close_date.slice(0, 10)}T00:00:00Z`),
      )
    : '';

  const priorityLabel = (PRIORITIES as readonly string[]).includes(deal.priority)
    ? t(`enums.priority.${deal.priority}`)
    : deal.priority;

  const contactName = (c: { first_name: string; last_name: string; email: string }) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

  // Pre-fill del booking con el primer contacto asociado (si hay).
  const primaryContact = contacts[0];
  const meetingTypes = eventTypes.map((et) => ({
    slug: et.slug,
    title: et.title,
    durationMin: et.duration_min,
    path: `/book/${user.handle}/${et.slug}`,
  }));

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
    splits: t('splits.title'),
    forecast_category: t('reportBuilder.fields.deal.forecastCategory'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    priority: Object.fromEntries(PRIORITIES.map((v) => [v, t(`enums.priority.${v}`)])),
    source: Object.fromEntries(SOURCES.map((v) => [v, t(`enums.source.${v}`)])),
    forecast_category: Object.fromEntries(
      ['pipeline', 'best_case', 'commit', 'omit'].map((v) => [v, t(`forecast.category.${v}`)]).concat([['', t('forecast.category.auto', { category: t('forecast.byStage') })]]),
    ),
  };

  const header = (
    <>
      <PageHeader
        back={{ href: '/app/crm/deals', label: t('record.back.deals') }}
        title={deal.name}
        description={
          <span className="record-meta">
            <span className="record-amount num">{fmtAmount(deal.amount, deal.currency)}</span>
            {baseAmount !== null && (
              <span className="num" title={t('currency.convertedHint', { base: currencyCtx.base })}>
                ≈ {formatMoney(baseAmount, currencyCtx.base, locale)}
              </span>
            )}
            <span className={`badge prio-${deal.priority}`}>{priorityLabel}</span>
            {pipeline && <span>{pipeline.name}</span>}
            {company && (
              <Link href={`/app/crm/companies/${company.id}`} className="record-meta-link">
                {company.name}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <PlaybookLauncher
              entity="deal"
              entityId={deal.id}
              values={{
                amount: String(deal.amount ?? ''),
                closeDate: deal.close_date ? deal.close_date.slice(0, 10) : '',
                priority: deal.priority,
                description: deal.description,
                ...Object.fromEntries(Object.entries(parseCustom(deal.custom)).map(([k, v]) => [`custom.${k}`, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
              }}
            />
            <BookMeetingMenu
              eventTypes={meetingTypes}
              name={primaryContact ? contactName(primaryContact) || undefined : undefined}
              email={primaryContact?.email || undefined}
              locale={locale}
            />
            <RecordMoreMenu
              items={[
                {
                  key: 'history',
                  label: t('record.more.history'),
                  title: t('history.title'),
                  content: (
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
                    />
                  ),
                },
                {
                  key: 'delete',
                  label: t('record.more.deleteDeal'),
                  title: t('deals.detail.deleteTitle'),
                  tone: 'danger',
                  content: (
                    <DangerDelete
                      bare
                      endpoint={`/api/crm/deals/${deal.id}`}
                      confirmToken={deal.name}
                      redirectTo="/app/crm/deals"
                      title={t('deals.detail.deleteTitle')}
                      desc={t('deals.detail.deleteDesc')}
                      buttonLabel={t('deals.detail.deleteButton')}
                      confirmLabel={t('record.confirmType', { token: deal.name })}
                      errorLabel={t('errors.generic')}
                    />
                  ),
                },
              ]}
            />
          </>
        }
      />
      <RecordTags
        entity="deal"
        recordId={deal.id}
        tags={recordTags.get(deal.id) ?? []}
        allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
      />
      <section className="record-stage" aria-label={t('deals.form.stage')}>
        <DealStagePanel
          dealId={deal.id}
          stages={stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost }))}
          currentStageId={deal.stage_id}
        />
        {approvalItem && <ApprovalBanner approval={approvalItem} me={realUserId(user)} />}
        {(deal.closed_at || deal.lost_reason) && (
          <p className="record-stage-note">
            {deal.closed_at && (
              <span>
                {t('deals.detail.closedAt')}: {fmtDate(deal.closed_at)}
              </span>
            )}
            {deal.lost_reason && (
              <span>
                {t('deals.detail.lostReason')}: {deal.lost_reason}
              </span>
            )}
          </p>
        )}
      </section>
    </>
  );

  // ---------- Actividad ----------
  if (tab === 'activity') {
    const [activities, threads, emailTemplates, emailSettings, nextTask] = await Promise.all([
      listTimeline(user.id, { dealId: id, limit: 100, ownerScope: scope }),
      listEmailThreads(user.id, { dealId: id, limit: 100 }),
      listEmailTemplates(user.id),
      getEmailSettings(user.id),
      nextTaskFor(user.id, { dealId: id }),
    ]);
    const timeline = await withCallSummaries(user.id, await withCallDetails(user.id, await withActivityFiles(mergeTimelineWithThreads(activities, threads))));
    const [aiAvailable, aiSummary, aiScore] = await Promise.all([crmAiAvailable(), getRecordSummary(user.id, 'deal', deal.id, scope), getDealScore(user.id, deal.id, scope)]);
    const recordFiles = (await listRecordFiles(user.id, 'deal', deal.id)).map(toView);
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-activity">
            <div className="record-activity-main">
              <NextTaskBanner
                task={nextTask ? { id: nextTask.id, subject: nextTask.subject, due_at: nextTask.due_at } : null}
                locale={locale}
              />
              <Timeline
                recordType="deal"
                recordId={deal.id}
                items={timeline}
                emptyLabel={t('deals.detail.emptyTimeline')}
                mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
                locale={locale}
                defaultEmail={primaryContact?.email ?? ''}
                emailTools={{
                  templates: emailTemplates.map((x) => ({
                    id: x.id,
                    kind: x.kind,
                    name: x.name,
                    subject: x.subject,
                    body: x.body,
                  })),
                  aiEnabled: aiEnabled(),
                  trackingDefault: emailSettings.trackingEnabled,
                  contactId: primaryContact?.id,
                  dealId: deal.id,
                }}
              />
            </div>
            <aside className="record-summary" aria-label={t('record.summary')}>
              <AiSummaryCard entity="deal" id={deal.id} locale={locale} initial={aiSummary} available={aiAvailable} />
              <DealInsightCard dealId={deal.id} locale={locale} initial={aiScore} available={aiAvailable} closed={!!(detail.stage?.is_won || detail.stage?.is_lost)} />
              <dl className="record-facts">
                <div>
                  <dt>{t('deals.form.amount')}</dt>
                  <dd className="num">{fmtAmount(deal.amount, deal.currency)}</dd>
                </div>
                <div>
                  <dt>{t('deals.form.closeDate')}</dt>
                  <dd>{closeDateLabel || '—'}</dd>
                </div>
                <div>
                  <dt>{t('deals.form.owner')}</dt>
                  <dd>{ownerLabel}</dd>
                </div>
                <div>
                  <dt>{t('deals.form.priority')}</dt>
                  <dd>{priorityLabel}</dd>
                </div>
                <ActivityDateFacts record={deal} locale={locale} />
              </dl>
              <Link href={recordTabHref(base, 'properties')} className="record-summary-more">
                {t('deals.detail.viewAllProperties')}
              </Link>
              <DealSplitsPanel
                key={splits.map((s) => `${s.ownerId}:${s.percent}`).join(',')}
                dealId={deal.id}
                ownerId={deal.owner_id ?? user.id}
                amount={deal.amount}
                currency={deal.currency}
                locale={locale}
                people={ownerOptions}
                splits={splits}
              />
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('deals.detail.contacts')} <span className="num">{contacts.length}</span>
                </h2>
                {contacts.length === 0 ? (
                  <p className="muted">{t('deals.detail.noContacts')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {contacts.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <Link href={`/app/crm/contacts/${c.id}`}>{contactName(c)}</Link>
                        {c.email && <span className="muted">{c.email}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('deals.detail.companies')} <span className="num">{dealCompanies.length}</span>
                </h2>
                {dealCompanies.length === 0 ? (
                  <p className="muted">{t('deals.detail.noCompany')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {dealCompanies.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <Link href={`/app/crm/companies/${c.id}`}>{c.name}</Link>
                        {c.domain && <span className="muted">{c.domain}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Link href={recordTabHref(base, 'related')} className="record-summary-more">
                {t('record.manageRelated')}
              </Link>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('files.title')} <span className="num">{recordFiles.length}</span>
                </h2>
                <FilesPanel endpoint={`/api/crm/deals/${deal.id}/files`} files={recordFiles} />
              </div>
            </aside>
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Propiedades ----------
  if (tab === 'properties') {
    const fieldAccess = await fieldAccessFor(sessionFieldViewer(user), 'deals');
    const customFieldDefs = fieldAccess.visible;
    const custom = parseCustom(redactCustomJson(deal.custom, fieldAccess.hidden));
    const customFields = customPropFields(customFieldDefs, custom, {
      yes: t('common.yes'),
      no: t('common.no'),
      locale,
      owners: ownerOptions,
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
        display: closeDateLabel || undefined,
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
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-props">
            <PropertiesPanel endpoint={`/api/crm/deals/${deal.id}`} fields={fields} custom={custom} sections={sections} />
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Relacionados: empresas, contactos, productos, cotizaciones ----------
  const [lineSummary, activeProducts, dealQuotes, contactRows, allCompanies] = await Promise.all([
    listLineItems(user.id, id),
    listProducts(user.id, { active: true, pageSize: 200 }),
    listQuotes(user.id, { dealId: id, pageSize: 50 }),
    getDb()
      .prepare(
        `SELECT id, first_name, last_name, email FROM crm_contacts
         WHERE user_id = ?${scopeAnd('crm_contacts', scope).sql} ORDER BY created_at DESC LIMIT 200`,
      )
      .all(user.id, ...scopeAnd('crm_contacts', scope).args) as Promise<
      Array<{ id: string; first_name: string; last_name: string; email: string }>
    >,
    getDb()
      .prepare(
        `SELECT id, name, domain FROM crm_companies WHERE user_id = ?${scopeAnd('crm_companies', scope).sql} ORDER BY name ASC LIMIT 200`,
      )
      .all(user.id, ...scopeAnd('crm_companies', scope).args) as Promise<Array<{ id: string; name: string; domain: string }>>,
  ]);
  const realPerson = user.actingUser ?? user;
  const associatedContactIds = new Set(contacts.map((c) => c.id));

  return (
    <div className="ui-page record-page">
      {header}
      <RecordTabs>
        <div className="record-related">
          <section className="record-block">
            <AssociationPanel
              title={t('deals.detail.contacts')}
              count={contacts.length}
              records={contacts.map((c) => ({
                id: c.id,
                name: contactName(c),
                href: `/app/crm/contacts/${c.id}`,
                meta: c.email || undefined,
              }))}
              options={contactRows
                .filter((c) => !associatedContactIds.has(c.id))
                .map((c) => ({ id: c.id, value: contactName(c) }))}
              onAssociate={associateContactToDeal.bind(null, deal.id)}
              onRemove={removeContactFromDeal.bind(null, deal.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('deals.detail.noContacts')}
            />
          </section>

          <section className="record-block">
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

          <section className="record-block record-block-wide" id="line-items">
            <div className="assoc-head">
              <h2 className="assoc-title">{t('lineItems.title')}</h2>
              {lineSummary && lineSummary.items.length > 0 && (
                <span className="assoc-count num">{lineSummary.items.length}</span>
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

          <section className="record-block record-block-wide" id="quotes">
            <div className="assoc-head">
              <h2 className="assoc-title">{t('quotes.title')}</h2>
              {dealQuotes.total > 0 && <span className="assoc-count num">{dealQuotes.total}</span>}
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
          <RelatedObjectRecords workspaceId={user.id} entity="deal" entityId={deal.id} scope={scope} locale={locale} />
        </div>
      </RecordTabs>
    </div>
  );
}
