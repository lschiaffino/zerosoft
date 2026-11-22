import { getTranslations } from 'next-intl/server';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { userCanUseApp, workspaceTeamId } from '@/lib/workspace';
import { listApprovals } from '@/lib/crm-approvals';
import { getSplits } from '@/lib/crm-splits';
import ApprovalBanner, { type ApprovalBannerItem } from '@/components/crm/ApprovalBanner';
import DealSplitsPanel from '@/components/crm/DealSplitsPanel';
import { canSeeActivity, canSeeOwner, scopeDealDetail, sessionScope, scopeAnd } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, nextTaskFor, parseCustom, PRIORITIES, SOURCES } from '@/lib/crm';
import { DEAL_TYPES } from '@/lib/crm-constants';
import DangerDelete from '@/components/crm/DangerDelete';
import CloneDeal from '@/components/crm/CloneDeal';
import { buildDealCloneBody } from '@/lib/crm-deal-clone';
import AssociationPanel from '@/components/crm/AssociationPanel';
import {
  associateCompanyToDeal,
  removeCompanyFromDealByDeal,
  setDealCompanyPrimary,
  associateContactToDeal,
  removeContactFromDeal,
  setDealContactLabel,
} from '@/components/crm/associationActions';
import { assocLabelOptions, listAssociationLabels } from '@/lib/crm-assoc-labels';
import DealStagePanel from '@/components/crm/DealStagePanel';
import LineItemsPanel from '@/components/crm/LineItemsPanel';
import DealQuotesPanel from '@/components/crm/DealQuotesPanel';
import { listLineItems, listProducts, listQuotes } from '@/lib/crm-products';
import BookMeetingMenu from '@/components/crm/BookMeetingMenu';
import PlaybookLauncher from '@/components/crm/PlaybookLauncher';
import { listEventTypes } from '@/lib/calendar';
import { customFieldSections, customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView } from '@/lib/crm-files';
import AiSummaryCard from '@/components/crm/AiSummaryCard';
import { crmAiAvailable, getRecordSummary, getDealScore } from '@/lib/crm-ai';
import DealInsightCard from '@/components/crm/DealInsightCard';
import { getEmailSettings, listEmailTemplates } from '@/lib/crm-email';
import { buildRecordTimeline } from '@/lib/crm-timeline';
import { aiEnabled } from '@/lib/ai';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';
import { getCurrencyContext } from '@/lib/crm-currency';
import { convertAmount, formatMoney } from '@/lib/crm-money';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import RecordTags from '@/components/crm/RecordTags';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import RecordColumns, { RecordAssociationSummary, RecordIdentity, RecordRecentCommunications } from '@/components/crm/RecordColumns';
import RecordCard from '@/components/crm/RecordCard';
import { COMPOSE_TYPES, layoutTabHref, parseCompose, parseLayoutTab, recentCommunications } from '@/components/crm/recordLayout';
import { parseDbUtc } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface DealDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DealDetailPage(props: DealDetailPageProps) {
  const [{ locale, id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tab = parseLayoutTab(searchParams.tab);
  const compose = parseCompose(searchParams.compose);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const rawDetail = await getDeal(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.deal.owner_id, user.id)) notFound();
  const detail = scopeDealDetail(rawDetail, scope);
  const { deal, pipeline, contacts, company, companies: dealCompanies } = detail;
  const base = `/app/crm/deals/${deal.id}`;
  const [currencyCtx, allTags, recordTags, teamMembers, eventTypes, stages, approvals, splits, assocLabels] = await Promise.all([
    getCurrencyContext(user.id),
    listTags(user.id),
    tagsForRecords(user.id, 'deal', [id]),
    workspaceTeamId(user)
      ? listMembers(workspaceTeamId(user)!)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    listEventTypes(user.id, { activeOnly: true }),
    getDb()
      .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
      .all(deal.pipeline_id) as Promise<CrmStageRow[]>,
    listApprovals(user.id, { dealId: id, limit: 5 }),
    getSplits(user.id, id),
    listAssociationLabels(user.id, 'deal_contact'),
  ]);
  const contactLabelOptions = assocLabelOptions('deal_contact', assocLabels, (k) => k);
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
    deal_type: t('deals.form.dealType'),
    next_step: t('deals.form.nextStep'),
    won_reason: t('deals.form.wonReason'),
    stage: t('deals.form.stage'),
    owner_id: t('deals.form.owner'),
    splits: t('splits.title'),
    forecast_category: t('reportBuilder.fields.deal.forecastCategory'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    priority: Object.fromEntries(PRIORITIES.map((v) => [v, t(`enums.priority.${v}`)])),
    source: Object.fromEntries(SOURCES.map((v) => [v, t(`enums.source.${v}`)])),
    deal_type: Object.fromEntries(DEAL_TYPES.map((v) => [v, t(`enums.dealType.${v}`)])),
    forecast_category: Object.fromEntries(
      ['pipeline', 'best_case', 'commit', 'omit'].map((v) => [v, t(`forecast.category.${v}`)]).concat([['', t('forecast.category.auto', { category: t('forecast.byStage') })]]),
    ),
  };

  // La copia lleva solo las propiedades propias que la persona puede editar.
  const headerFieldAccess = await fieldAccessFor(sessionFieldViewer(user), 'deals');
  const cloneRestricted = headerFieldAccess.restricted;
  // Los valores para las condiciones del playbook llegan al cliente: sin los campos ocultos.
  const playbookCustom = parseCustom(redactCustomJson(deal.custom, headerFieldAccess.hidden));
  const cloneBody = buildDealCloneBody(
    { ...deal, custom: redactCustomJson(deal.custom, new Set(cloneRestricted.keys())) },
    stages,
    {
      contactIds: contacts.map((c) => c.id),
      companyId: company?.id ?? null,
      companyIds: dealCompanies.map((c) => c.id),
    },
    t('deals.detail.cloneSuffix'),
  );

  const activityTypeLabels = Object.fromEntries(COMPOSE_TYPES.map((v) => [v, t(`enums.activityType.${v}`)]));

  const actions = (
    <>
      <PlaybookLauncher
        entity="deal"
        entityId={deal.id}
        values={{
          amount: String(deal.amount ?? ''),
          closeDate: deal.close_date ? deal.close_date.slice(0, 10) : '',
          priority: deal.priority,
          description: deal.description,
          ...Object.fromEntries(Object.entries(playbookCustom).map(([k, v]) => [`custom.${k}`, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
        }}
      />
      {userCanUseApp(user, 'sign') && user.role !== 'guest' && (
        <Link className="btn btn-outline btn-sm" href={`/app/sign/new?crm=deal:${deal.id}`}>
          {t('record.sendForSignature')}
        </Link>
      )}
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
          ...(cloneBody && user.role !== 'guest'
            ? [
                {
                  key: 'clone',
                  label: t('record.more.cloneDeal'),
                  title: t('deals.detail.cloneTitle'),
                  content: <CloneDeal body={cloneBody} name={deal.name} />,
                },
              ]
            : []),
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
  );

  // Etapa del deal: arriba de las pestañas, a la vista en todas.
  const stagePanel = (
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
  );

  // La ficha carga todo de una vez: las tres columnas están a la vista juntas.
  const contactScope = scopeAnd('crm_contacts', scope);
  const companyScope = scopeAnd('crm_companies', scope);
  // Tareas de chats de Lines que la persona no ve: sin su texto.
  const chatReader = await sessionChatReader(user, locale);
  const [
    timelinePage,
    emailTemplates,
    emailSettings,
    nextTaskRaw,
    aiAvailable,
    aiSummaryRaw,
    aiScoreRaw,
    recordFilesRaw,
    fieldAccess,
    lineSummary,
    activeProducts,
    dealQuotes,
    contactRows,
    allCompanies,
  ] = await Promise.all([
    buildRecordTimeline(user, { kind: 'deal', id }, { ownerScope: scope, chatReader }),
    listEmailTemplates(user.id),
    getEmailSettings(user.id),
    nextTaskFor(user.id, { dealId: id, chatReader }),
    crmAiAvailable(),
    getRecordSummary(user.id, 'deal', deal.id, scope),
    getDealScore(user.id, deal.id, scope),
    listRecordFiles(user.id, 'deal', deal.id),
    fieldAccessFor(sessionFieldViewer(user), 'deals'),
    listLineItems(user.id, id),
    listProducts(user.id, { active: true, pageSize: 200 }),
    listQuotes(user.id, { dealId: id, pageSize: 50 }),
    getDb()
      .prepare(
        `SELECT id, first_name, last_name, email FROM crm_contacts
         WHERE user_id = ?${contactScope.sql} ORDER BY created_at DESC LIMIT 200`,
      )
      .all(user.id, ...contactScope.args) as Promise<
      Array<{ id: string; first_name: string; last_name: string; email: string }>
    >,
    getDb()
      .prepare(
        `SELECT id, name, domain FROM crm_companies WHERE user_id = ?${companyScope.sql} ORDER BY name ASC LIMIT 200`,
      )
      .all(user.id, ...companyScope.args) as Promise<Array<{ id: string; name: string; domain: string }>>,
  ]);
  // Con alcance restringido (ver la ficha de contacto): próxima tarea, resumen y score de IA
  // solo si corresponden a lo que la persona ve. Los emails salen solo de los contactos del deal que
  // la persona ve (lib/crm-timeline.ts visibleEmailContacts).
  const nextTask = nextTaskRaw && (!scope || (await canSeeActivity(user.id, nextTaskRaw.id, scope))) ? nextTaskRaw : null;
  const aiSummary = scope && aiSummaryRaw?.stale ? null : aiSummaryRaw;
  const aiScore = scope && aiScoreRaw?.stale ? null : aiScoreRaw;
  const timeline = timelinePage.items;
  const recordFiles = recordFilesRaw.map(toView);
  const realPerson = user.actingUser ?? user;
  const associatedContactIds = new Set(contacts.map((c) => c.id));

  // ---------- Izquierda: propiedades, editables en línea ----------
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
      key: 'dealType',
      label: t('deals.form.dealType'),
      type: 'select',
      value: deal.deal_type ?? '',
      // '' lo deja sin elegir (la API lo acepta).
      options: [{ value: '', label: '—' }, ...DEAL_TYPES.map((v) => ({ value: v as string, label: t(`enums.dealType.${v}`) }))],
    },
    { key: 'nextStep', label: t('deals.form.nextStep'), type: 'text', value: deal.next_step ?? '' },
    { key: 'wonReason', label: t('deals.form.wonReason'), type: 'text', value: deal.won_reason ?? '' },
    {
      key: 'ownerId',
      label: t('deals.form.owner'),
      type: 'select',
      value: deal.owner_id ?? user.id,
      options: ownerOptions,
    },
    ...customFields,
  ];
  const sections: Array<PropSection & { id: string }> = [
    {
      id: 'about',
      title: t('deals.detail.aboutSection'),
      keys: ['name', 'amount', 'currency', 'closeDate', 'priority', 'dealType', 'source', 'nextStep', 'description', 'wonReason'],
    },
    { id: 'ownership', title: t('deals.detail.ownershipSection'), keys: ['ownerId'] },
    // Una tarjeta por grupo de propiedades (Ajustes › Datos); las sin grupo, en la de siempre.
    ...customFieldSections(customFieldDefs, customFields, t('deals.detail.customFieldsSection')),
  ];

  const about = (
    <>
      {sections.map((s) => (
        <RecordCard key={s.id} id={`deal.${s.id}`} label={s.title}>
          <PropertiesPanel
            endpoint={`/api/crm/deals/${deal.id}`}
            fields={fields.filter((f) => s.keys.includes(f.key))}
            custom={custom}
          />
        </RecordCard>
      ))}
    </>
  );

  // ---------- Medio: Resumen y Actividad ----------
  const nextTaskBanner = (
    <NextTaskBanner
      task={nextTask ? { id: nextTask.id, subject: nextTask.subject, due_at: nextTask.due_at } : null}
      locale={locale}
    />
  );
  // Productos y cotizaciones van en el medio: sus tablas no entran en una columna lateral.
  const overview = (
    <>
      {nextTaskBanner}
      <section className="rec-overview-block" data-testid="record-highlights">
        <h2 className="rec-overview-title">{t('record.highlights')}</h2>
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
      </section>

      <section className="rec-overview-block" id="line-items">
        <h2 className="rec-overview-title">
          {t('lineItems.title')}
          {lineSummary && lineSummary.items.length > 0 && (
            <span className="rec-card-count num">{lineSummary.items.length}</span>
          )}
        </h2>
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

      <section className="rec-overview-block" id="quotes">
        <h2 className="rec-overview-title">
          {t('quotes.title')}
          {dealQuotes.total > 0 && <span className="rec-card-count num">{dealQuotes.total}</span>}
        </h2>
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

      <RecordRecentCommunications
        items={recentCommunications(timeline)}
        locale={locale}
        title={t('record.recentCommunications')}
        emptyLabel={t('record.noCommunications')}
        moreLabel={t('record.seeAllActivity')}
        moreHref={layoutTabHref(base, 'activity')}
        typeLabels={activityTypeLabels}
      />
      <RecordAssociationSummary
        testId="record-summary-contacts"
        title={t('deals.detail.contacts')}
        rows={contacts.map((c) => ({ id: c.id, name: contactName(c), href: `/app/crm/contacts/${c.id}`, meta: c.email || undefined }))}
        emptyLabel={t('deals.detail.noContacts')}
        moreLabel={t('record.moreCount', { count: Math.max(contacts.length - 5, 0) })}
      />
      <RecordAssociationSummary
        testId="record-summary-companies"
        title={t('deals.detail.companies')}
        rows={dealCompanies.map((c) => ({ id: c.id, name: c.name, href: `/app/crm/companies/${c.id}`, meta: c.domain || undefined }))}
        emptyLabel={t('deals.detail.noCompany')}
        moreLabel={t('record.moreCount', { count: Math.max(dealCompanies.length - 5, 0) })}
      />
    </>
  );

  const activity = (
    <>
      {nextTaskBanner}
      <Timeline
        recordType="deal"
        recordId={deal.id}
        items={timeline}
        hasMore={timelinePage.hasMore}
        currentPersonId={user.actingUser?.id ?? user.id}
        emptyLabel={t('deals.detail.emptyTimeline')}
        mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
        locale={locale}
        defaultEmail={primaryContact?.email ?? ''}
        compose={compose}
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
    </>
  );

  // ---------- Derecha: asociaciones ----------
  const right = (
    <>
      <RecordCard id="deal.ai" label={t('ai.summary.title')} bare>
        <AiSummaryCard entity="deal" id={deal.id} locale={locale} initial={aiSummary} available={aiAvailable} />
      </RecordCard>
      <RecordCard id="deal.insight" label={t('ai.score.title')} bare>
        <DealInsightCard dealId={deal.id} locale={locale} initial={aiScore} available={aiAvailable} closed={!!(detail.stage?.is_won || detail.stage?.is_lost)} />
      </RecordCard>

      <RecordCard
        id="deal.contacts"
        label={t('deals.detail.contacts')}
        count={contacts.length}
        addLabel={contactRows.some((c) => !associatedContactIds.has(c.id)) ? t('record.cards.add') : undefined}
      >
        <AssociationPanel
          records={contacts.map((c) => ({
            id: c.id,
            name: contactName(c),
            href: `/app/crm/contacts/${c.id}`,
            meta: c.email || undefined,
            label: c.assoc_label,
          }))}
          onSetLabel={contactLabelOptions.length ? setDealContactLabel.bind(null, deal.id) : undefined}
          labelOptions={contactLabelOptions.length ? contactLabelOptions : undefined}
          options={contactRows
            .filter((c) => !associatedContactIds.has(c.id))
            .map((c) => ({ id: c.id, value: contactName(c) }))}
          onAssociate={associateContactToDeal.bind(null, deal.id)}
          onRemove={removeContactFromDeal.bind(null, deal.id)}
          addLabel={t('assoc.pickContact')}
          emptyLabel={t('deals.detail.noContacts')}
        />
      </RecordCard>

      <RecordCard
        id="deal.companies"
        label={t('deals.detail.companies')}
        count={dealCompanies.length}
        addLabel={allCompanies.some((c) => !dealCompanies.some((dc) => dc.id === c.id)) ? t('record.cards.add') : undefined}
      >
        <AssociationPanel
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
      </RecordCard>

      <RecordCard id="deal.splits" label={t('splits.title')} bare>
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
      </RecordCard>

      <RecordCard id="deal.files" label={t('files.title')} count={recordFiles.length}>
        <FilesPanel endpoint={`/api/crm/deals/${deal.id}/files`} files={recordFiles} />
      </RecordCard>

      <RelatedObjectRecords workspaceId={user.id} entity="deal" entityId={deal.id} scope={scope} locale={locale} />
    </>
  );

  return (
    <RecordColumns
      tab={tab}
      base={base}
      back={{ href: '/app/crm/deals', label: t('record.back.deals') }}
      actions={actions}
      identity={
        <RecordIdentity
          name={deal.name}
          avatar={null}
          quick={COMPOSE_TYPES}
          keyLine={
            <>
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
            </>
          }
          tags={
            <RecordTags
              entity="deal"
              recordId={deal.id}
              tags={recordTags.get(deal.id) ?? []}
              allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
            />
          }
        />
      }
      about={about}
      aboutLabel={t('record.layoutTabs.properties')}
      lead={stagePanel}
      overview={overview}
      activity={activity}
      right={right}
      rightLabel={t('record.layoutTabs.related')}
    />
  );
}
