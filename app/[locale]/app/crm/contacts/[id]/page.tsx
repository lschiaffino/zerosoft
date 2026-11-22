import { notFound } from 'next/navigation';
import CrmTrackRequests from '@/components/track/triage/CrmTrackRequests';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import RelatedLeads from '@/components/crm/RelatedLeads';
import { fieldAccessFor, hiddenFieldsFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { userCanUseApp, workspaceTeamId } from '@/lib/workspace';
import { canSeeActivity, canSeeOwner, ownerScopeSql, scopeContactDetail, sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { scoreTier } from '@/lib/crm-scoring-schema';
import { contactScores, listScores } from '@/lib/crm-scoring';
import { getDb } from '@/lib/db';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  getContact,
  listCompanies,
  listPipelinesWithStages,
  nextTaskFor,
  parseCustom,
} from '@/lib/crm';
import { customFieldSections, customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView } from '@/lib/crm-files';
import AiSummaryCard from '@/components/crm/AiSummaryCard';
import { crmAiAvailable, getRecordSummary } from '@/lib/crm-ai';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import ContactAddDeal from '@/components/crm/ContactAddDeal';
import AssociationPanel from '@/components/crm/AssociationPanel';
import CompanyQuickCreate from '@/components/crm/CompanyQuickCreate';
import DuplicatesPanel from '@/components/crm/DuplicatesPanel';
import PhoneTouch from '@/components/crm/PhoneTouch';
import PlaybookLauncher from '@/components/crm/PlaybookLauncher';
import {
  associateCompanyToContact,
  removeCompanyFromContact,
  setContactCompanyLabel,
  setContactDealLabel,
  setContactCompanyPrimary,
  associateDealToContact,
  removeDealFromContact,
} from '@/components/crm/associationActions';
import DangerDelete from '@/components/crm/DangerDelete';
import BookMeetingMenu from '@/components/crm/BookMeetingMenu';
import { listEventTypes } from '@/lib/calendar';
import { listMembers } from '@/lib/teams';
import HistoryPanel from '@/components/crm/HistoryPanel';
import SequencePanel from '@/components/crm/SequencePanel';
import { getEmailSettings, listEmailTemplates } from '@/lib/crm-email';
import { buildRecordTimeline } from '@/lib/crm-timeline';
import { listEnrollments, listSequences } from '@/lib/crm-sequences';
import { aiEnabled } from '@/lib/ai';
import { assocLabelOptions, listAssociationLabels } from '@/lib/crm-assoc-labels';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import RecordTags from '@/components/crm/RecordTags';
import CrmGroupsBlock from '@/components/groups/CrmGroupsBlock';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import RecordColumns, { RecordAssociationSummary, RecordIdentity, RecordRecentCommunications } from '@/components/crm/RecordColumns';
import PropertySearch from '@/components/crm/PropertySearch';
import RecordCard from '@/components/crm/RecordCard';
import RecordWorkflows from '@/components/crm/RecordWorkflows';
import { listRecordEnrollments } from '@/lib/crm-workflows';
import { COMPOSE_TYPES, layoutTabHref, parseCompose, parseLayoutTab, recentCommunications } from '@/components/crm/recordLayout';
import { formatPhoneDisplay } from '@/lib/crm-calls';
import { maskDetailRefs } from '@/lib/crm-record-scope';

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

export default async function ContactDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tab = parseLayoutTab(searchParams.tab);
  const compose = parseCompose(searchParams.compose);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const rawDetail = await getContact(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.contact.owner_id, user.id)) notFound();
  const detail = await maskDetailRefs(user.id, 'contact', scopeContactDetail(rawDetail, scope), scope);

  const { contact, company, companies: contactCompanies, deals, lists } = detail;
  const base = `/app/crm/contacts/${contact.id}`;
  const [allTags, recordTags, teamMembers, eventTypes, assocLabels] = await Promise.all([
    listTags(user.id),
    tagsForRecords(user.id, 'contact', [id]),
    workspaceTeamId(user)
      ? listMembers(workspaceTeamId(user)!)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    listEventTypes(user.id, { activeOnly: true }),
    listAssociationLabels(user.id),
  ]);
  const companyLabelOptions = assocLabelOptions('contact_company', assocLabels, (k) => t(`enums.contactCompanyLabel.${k}`));
  const dealLabelOptions = assocLabelOptions('deal_contact', assocLabels, (k) => k);
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const ownerLabel = ownerOptions.find((o) => o.value === (contact.owner_id ?? user.id))?.label ?? '—';

  const name = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || '—';
  const meetingTypes = eventTypes.map((et) => ({
    slug: et.slug,
    title: et.title,
    durationMin: et.duration_min,
    path: `/book/${user.handle}/${et.slug}`,
  }));

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
    lifecycle_stage: Object.fromEntries(LIFECYCLE_STAGES.map((v) => [v, t(`enums.lifecycle.${v}`)])),
    lead_status: Object.fromEntries(LEAD_STATUSES.map((v) => [v, t(`enums.leadStatus.${v}`)])),
    source: Object.fromEntries(SOURCES.map((v) => [v, t(`enums.source.${v}`)])),
  };

  const activityTypeLabels = Object.fromEntries(COMPOSE_TYPES.map((v) => [v, t(`enums.activityType.${v}`)]));

  // Los valores para las condiciones del playbook llegan al cliente: sin los campos ocultos.
  const playbookCustom = parseCustom(redactCustomJson(contact.custom, await hiddenFieldsFor(sessionFieldViewer(user), 'contacts')));

  const actions = (
    <>
      {contact.phone && <PhoneTouch phone={contact.phone} contactId={contact.id} name={name} />}
      <PlaybookLauncher
        entity="contact"
        entityId={contact.id}
        values={{
          jobTitle: contact.job_title,
          lifecycleStage: contact.lifecycle_stage,
          leadStatus: contact.lead_status,
          phone: contact.phone,
          city: contact.city,
          country: contact.country,
          website: contact.website,
          ...Object.fromEntries(Object.entries(playbookCustom).map(([k, v]) => [`custom.${k}`, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
        }}
      />
      {userCanUseApp(user, 'sign') && user.role !== 'guest' && (
        <Link className="btn btn-outline btn-sm" href={`/app/sign/new?crm=contact:${contact.id}`}>
          {t('record.sendForSignature')}
        </Link>
      )}
      <BookMeetingMenu
        eventTypes={meetingTypes}
        name={`${contact.first_name} ${contact.last_name}`.trim() || undefined}
        email={contact.email || undefined}
        locale={locale}
      />
      <RecordMoreMenu
        items={[
          {
            key: 'duplicates',
            label: t('record.more.duplicates'),
            title: t('contacts.detail.duplicates'),
            content: <DuplicatesPanel contactId={contact.id} />,
          },
          {
            key: 'history',
            label: t('record.more.history'),
            title: t('history.title'),
            content: (
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
              />
            ),
          },
          {
            key: 'delete',
            label: t('record.more.deleteContact'),
            title: t('contacts.detail.deleteTitle'),
            tone: 'danger',
            content: (
              <DangerDelete
                bare
                endpoint={`/api/crm/contacts/${contact.id}`}
                confirmToken={contact.email || name}
                redirectTo="/app/crm/contacts"
                title={t('contacts.detail.deleteTitle')}
                desc={t('contacts.detail.deleteDesc')}
                buttonLabel={t('contacts.detail.deleteButton')}
                confirmLabel={t('record.confirmType', { token: contact.email || name })}
                errorLabel={t('errors.generic')}
              />
            ),
          },
        ]}
      />
    </>
  );

  // La ficha carga todo de una vez: las tres columnas están a la vista juntas.
  const dealScope = ownerScopeSql('d', scope);
  // Tareas de chats de Lines que la persona no ve: sin su texto.
  const chatReader = await sessionChatReader(user, locale);
  const [
    scores,
    timelinePage,
    emailTemplates,
    emailSettings,
    nextTaskRaw,
    companiesPage,
    fieldAccess,
    scoreViews,
    allDeals,
    enrollments,
    sequences,
    pipelines,
    aiAvailable,
    aiSummaryRaw,
    recordFilesRaw,
  ] = await Promise.all([
    listScores(user.id),
    buildRecordTimeline(user, { kind: 'contact', id }, { ownerScope: scope, chatReader }),
    listEmailTemplates(user.id),
    getEmailSettings(user.id),
    nextTaskFor(user.id, { contactId: id, chatReader }),
    listCompanies(user.id, { pageSize: 100, sort: 'name', ownerScope: scope }),
    fieldAccessFor(sessionFieldViewer(user), 'contacts'),
    contactScores(user.id, contact, undefined, sessionFieldViewer(user)),
    getDb()
      .prepare(
        `SELECT d.id, d.name FROM crm_deals d WHERE d.user_id = ?${dealScope.sql ? ` AND ${dealScope.sql}` : ''}
         ORDER BY d.created_at DESC LIMIT 200`,
      )
      .all(user.id, ...dealScope.args) as Promise<Array<{ id: string; name: string }>>,
    listEnrollments(user.id, { contactId: id, limit: 20 }),
    listSequences(user.id),
    listPipelinesWithStages(user.id),
    crmAiAvailable(),
    getRecordSummary(user.id, 'contact', contact.id, scope),
    listRecordFiles(user.id, 'contact', contact.id),
  ]);
  // Con alcance restringido: la próxima tarea solo si la persona puede ver esa actividad, y el
  // resumen de IA guardado solo si se generó con lo mismo que ella ve (mismo hash de contexto);
  // uno generado por alguien que ve más no se le muestra.
  const nextTask = nextTaskRaw && (!scope || (await canSeeActivity(user.id, nextTaskRaw.id, scope))) ? nextTaskRaw : null;
  const aiSummary = scope && aiSummaryRaw?.stale ? null : aiSummaryRaw;
  const primaryScore = scores.find((x) => x.isPrimary);
  const primaryTier = primaryScore ? scoreTier(contact.score ?? 0, primaryScore.thresholds) : null;
  const timelineItems = timelinePage.items;
  const recordFiles = recordFilesRaw.map(toView);
  const companies = companiesPage.rows;

  // ---------- Izquierda: propiedades, editables en línea ----------
  const customFieldDefs = fieldAccess.visible;
  const custom = parseCustom(redactCustomJson(contact.custom, fieldAccess.hidden));
  const customFields = customPropFields(customFieldDefs, custom, {
    yes: t('common.yes'),
    no: t('common.no'),
    locale,
    owners: ownerOptions,
  });
  const fields: PropField[] = [
    { key: 'firstName', label: t('contacts.form.firstName'), type: 'text', value: contact.first_name },
    { key: 'lastName', label: t('contacts.form.lastName'), type: 'text', value: contact.last_name },
    { key: 'email', label: t('contacts.form.email'), type: 'text', value: contact.email, href: contact.email ? `mailto:${contact.email}` : undefined },
    { key: 'phone', label: t('contacts.form.phone'), type: 'text', value: contact.phone, display: formatPhoneDisplay(contact.phone) },
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
    // `company` ya pasó por el alcance de la persona. Si la empresa principal existe pero no se
    // le muestra, la propiedad dice "Registro privado" y no tiene selector: no ve cuál es ni puede pisarla.
    // Si es visible pero no entró en las 100 primeras del selector, se suma para leer su nombre.
    (contact.company_id || (contact as { company_private?: boolean }).company_private) && !company
      ? {
          key: 'companyId',
          label: t('contacts.form.company'),
          type: 'select',
          value: 'private',
          options: [{ value: 'private', label: t('common.privateRecord') }],
          readOnly: true,
        }
      : {
          key: 'companyId',
          label: t('contacts.form.company'),
          type: 'select',
          value: company ? company.id : '',
          options: [
            ...(company && !companies.some((c) => c.id === company.id) ? [{ value: company.id, label: company.name }] : []),
            ...companies.map((c) => ({ value: c.id, label: c.name })),
          ],
          nullOption: true,
        },
    {
      key: 'ownerId',
      label: t('contacts.form.owner'),
      type: 'select',
      value: contact.owner_id ?? user.id,
      options: ownerOptions,
    },
    ...customFields,
  ];
  const sections: Array<PropSection & { id: string }> = [
    {
      id: 'about',
      title: t('contacts.detail.aboutSection'),
      keys: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'website', 'city', 'country'],
    },
    { id: 'lifecycle', title: t('contacts.detail.lifecycleSection'), keys: ['lifecycleStage', 'leadStatus', 'source'] },
    { id: 'ownership', title: t('contacts.detail.ownershipSection'), keys: ['ownerId', 'companyId'] },
    // Una tarjeta por grupo de propiedades (Ajustes › Datos); las sin grupo, en la de siempre.
    ...customFieldSections(customFieldDefs, customFields, t('contacts.detail.customFieldsSection')),
  ];

  const about = (
    <>
      {sections.map((s) => (
        <RecordCard key={s.id} id={`contact.${s.id}`} label={s.title}>
          <PropertiesPanel
            endpoint={`/api/crm/contacts/${contact.id}`}
            fields={fields.filter((f) => s.keys.includes(f.key))}
            custom={custom}
          />
        </RecordCard>
      ))}
      {scoreViews.map((sv) => (
        <RecordCard
          key={sv.scoreId}
          id={sv.isPrimary ? 'contact.score' : `contact.score.${sv.scoreId}`}
          label={sv.name}
          className="score-card"
          anchor={sv.isPrimary ? 'score' : `score-${sv.scoreId}`}
          testId="contact-score-card"
          aside={
            <span className="rec-card-aside">
              <span className="num score-card-value">{sv.score}</span>
              {sv.tier && (
                <span className="score-tier" data-testid="score-card-tier">
                  {sv.tier}
                </span>
              )}
            </span>
          }
        >
          {sv.breakdown.length === 0 ? (
            <p className="assoc-empty">{t('scoring.noBreakdown')}</p>
          ) : (
            <ul className="score-breakdown">
              {sv.breakdown.map((b) => (
                <li key={b.ruleId}>
                  <span className={`num score-points ${b.points >= 0 ? 'pos' : 'neg'}`}>
                    {b.points > 0 ? `+${b.points}` : b.points}
                  </span>
                  <span className="score-why">{b.name || t('scoring.unnamedRule')}</span>
                  {(b.detail || b.decayed) && (
                    <span className="muted score-detail">
                      {b.detail}
                      {b.decayed ? ` · ${t('scoring.decayedNote')}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
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
  const overview = (
    <>
      {nextTaskBanner}
      <section className="rec-overview-block" data-testid="record-highlights">
        <h2 className="rec-overview-title">{t('record.highlights')}</h2>
        <dl className="record-facts">
          <div>
            <dt>{t('contacts.form.owner')}</dt>
            <dd>{ownerLabel}</dd>
          </div>
          <div>
            <dt>{primaryScore?.name ?? t('scoring.column')}</dt>
            <dd className="num">
              {contact.score ?? 0}
              {primaryTier && <span className="score-tier">{primaryTier}</span>}
            </dd>
          </div>
          <ActivityDateFacts record={contact} locale={locale} />
        </dl>
      </section>
      <RecordRecentCommunications
        items={recentCommunications(timelineItems)}
        locale={locale}
        title={t('record.recentCommunications')}
        emptyLabel={t('record.noCommunications')}
        moreLabel={t('record.seeAllActivity')}
        moreHref={layoutTabHref(base, 'activity')}
        typeLabels={activityTypeLabels}
      />
      <RecordAssociationSummary
        testId="record-summary-companies"
        title={t('contacts.detail.companies')}
        rows={contactCompanies.map((c) => ({ id: c.id, name: c.name, href: `/app/crm/companies/${c.id}`, meta: c.domain || undefined }))}
        emptyLabel={t('contacts.detail.noCompany')}
        moreLabel={t('record.moreCount', { count: Math.max(contactCompanies.length - 5, 0) })}
      />
      <RecordAssociationSummary
        testId="record-summary-deals"
        title={t('contacts.detail.deals')}
        rows={deals.map((d) => ({
          id: d.id,
          name: d.name,
          href: `/app/crm/deals/${d.id}`,
          meta: [d.stage_name, money(d.amount, d.currency, locale)].filter(Boolean).join(' · '),
        }))}
        emptyLabel={t('contacts.detail.noDeals')}
        moreLabel={t('record.moreCount', { count: Math.max(deals.length - 5, 0) })}
      />
    </>
  );

  const activity = (
    <>
      {nextTaskBanner}
      <Timeline
        recordType="contact"
        recordId={contact.id}
        items={timelineItems}
        hasMore={timelinePage.hasMore}
        currentPersonId={user.actingUser?.id ?? user.id}
        emptyLabel={t('contacts.detail.emptyTimeline')}
        mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
        locale={locale}
        defaultEmail={contact.email}
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
          contactId: contact.id,
        }}
      />
    </>
  );

  // ---------- Derecha: asociaciones ----------
  // Pipeline default + primer stage abierto (para crear deals desde el detalle).
  const defaultPipeline = pipelines[0];
  const firstOpenStage =
    defaultPipeline?.stages.find((s) => !s.is_won && !s.is_lost) ?? defaultPipeline?.stages[0];

  // La persona ya ve el contacto (notFound arriba si no): sus inscripciones en workflows.
  const workflowEnrollments = await listRecordEnrollments(user.id, 'contact', contact.id, 20, sessionFieldViewer(user));

  const right = (
    <>
      <RecordCard id="contact.ai" label={t('ai.summary.title')} bare>
        <AiSummaryCard entity="contact" id={contact.id} locale={locale} initial={aiSummary} available={aiAvailable} />
      </RecordCard>

      <RecordCard
        id="contact.companies"
        label={t('contacts.detail.companies')}
        count={contactCompanies.length}
        addLabel={t('record.cards.add')}
      >
        <AssociationPanel
          records={contactCompanies.map((c) => ({
            id: c.id,
            name: c.name,
            href: `/app/crm/companies/${c.id}`,
            meta: c.domain || undefined,
            primary: !!c.is_primary,
            label: c.label,
          }))}
          options={companies
            .filter((c) => !contactCompanies.some((cc) => cc.id === c.id))
            .map((c) => ({ id: c.id, value: c.name }))}
          onAssociate={associateCompanyToContact.bind(null, contact.id)}
          onRemove={removeCompanyFromContact.bind(null, contact.id)}
          onSetPrimary={setContactCompanyPrimary.bind(null, contact.id)}
          onSetLabel={setContactCompanyLabel.bind(null, contact.id)}
          labelOptions={companyLabelOptions}
          addLabel={t('contacts.detail.associateCompany')}
          emptyLabel={t('contacts.detail.noCompany')}
          action={<CompanyQuickCreate contactId={contact.id} />}
        />
      </RecordCard>

      <RecordCard
        id="contact.deals"
        label={t('contacts.detail.deals')}
        count={deals.length}
        addLabel={allDeals.some((d) => !deals.some((dd) => dd.id === d.id)) || (defaultPipeline && firstOpenStage) ? t('record.cards.add') : undefined}
      >
        <AssociationPanel
          records={deals.map((d) => ({
            id: d.id,
            name: d.name,
            href: `/app/crm/deals/${d.id}`,
            meta: [d.stage_name, money(d.amount, d.currency, locale)].filter(Boolean).join(' · '),
            label: d.assoc_label,
          }))}
          options={allDeals
            .filter((d) => !deals.some((dd) => dd.id === d.id))
            .map((d) => ({ id: d.id, value: d.name }))}
          onAssociate={associateDealToContact.bind(null, contact.id)}
          onRemove={removeDealFromContact.bind(null, contact.id)}
          onSetLabel={dealLabelOptions.length ? setContactDealLabel.bind(null, contact.id) : undefined}
          labelOptions={dealLabelOptions.length ? dealLabelOptions : undefined}
          addLabel={t('assoc.pickDeal')}
          emptyLabel={t('contacts.detail.noDeals')}
          action={
            defaultPipeline && firstOpenStage ? (
              <ContactAddDeal
                pipelineId={defaultPipeline.id}
                stageId={firstOpenStage.id}
                contactId={contact.id}
              />
            ) : undefined
          }
        />
      </RecordCard>

      <RecordCard id="contact.files" label={t('files.title')} count={recordFiles.length}>
        <FilesPanel endpoint={`/api/crm/contacts/${contact.id}/files`} files={recordFiles} />
      </RecordCard>

      <RecordCard id="contact.sequences" label={t('sequences.panelTitle')} bare>
        <SequencePanel
          contactId={contact.id}
          sequences={sequences.map((sq) => ({ id: sq.id, name: sq.name }))}
          enrollments={enrollments.map((e) => ({
            id: e.id,
            sequenceId: e.sequence_id,
            sequenceName: e.sequence_name,
            status: e.status,
            exitReason: e.exit_reason,
            step: Math.min(e.current_step + 1, e.step_count),
            stepCount: e.step_count,
          }))}
        />
      </RecordCard>

      <RecordCard id="contact.lists" label={t('contacts.detail.lists')} count={lists.length}>
        {lists.length === 0 ? (
          <p className="assoc-empty">{t('contacts.detail.noLists')}</p>
        ) : (
          <ul className="assoc-list">
            {lists.map((l) => (
              <li key={l.id} className="assoc-row">
                <span className="assoc-main">
                  <Link href={`/app/crm/lists/${l.id}`} className="assoc-name">
                    {l.name}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </RecordCard>

      <RecordCard id="contact.leads" label={t('leads.contactLeads')} bare>
        <RelatedLeads
          workspaceId={user.id}
          contactId={contact.id}
          contactName={[contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email}
          scope={scope}
          locale={locale}
          owners={ownerOptions}
          defaultOwner={realUserId(user)}
        />
      </RecordCard>
      <RelatedObjectRecords workspaceId={user.id} entity="contact" entityId={contact.id} scope={scope} locale={locale} />
      <RecordCard id="contact.groups" label={t('record.cards.groups')} bare>
        <CrmGroupsBlock ws={user.id} kind="contact" recordId={contact.id} locale={locale} me={user.actingUser?.id ?? user.id} role={user.role} />
      </RecordCard>
      <RecordCard id="contact.track" label={t('record.cards.track')} bare>
        <CrmTrackRequests contactId={contact.id} locale={locale} />
      </RecordCard>
      <RecordCard id="contact.workflows" label={t('workflows.recordCard.title')} count={workflowEnrollments.length}>
        <RecordWorkflows enrollments={workflowEnrollments} canEdit={isWorkspaceAdmin(user)} />
      </RecordCard>
    </>
  );

  return (
    <RecordColumns
      tab={tab}
      base={base}
      back={{ href: '/app/crm/contacts', label: t('record.back.contacts') }}
      actions={actions}
      identity={
        <RecordIdentity
          name={name}
          quick={COMPOSE_TYPES}
          keyLine={
            <>
              {contact.lifecycle_stage && (
                <span className={`badge stage-${contact.lifecycle_stage}`}>
                  {t(`enums.lifecycle.${contact.lifecycle_stage}`)}
                </span>
              )}
              {contact.lead_status && (
                <span className="badge badge-outline">{t(`enums.leadStatus.${contact.lead_status}`)}</span>
              )}
              {contact.job_title && <span>{contact.job_title}</span>}
              {company && (
                <Link href={`/app/crm/companies/${company.id}`} className="record-meta-link">
                  {company.name}
                </Link>
              )}
              {/* Como en HubSpot: el email a mano debajo del nombre. */}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="record-meta-link" data-testid="record-email">
                  {contact.email}
                </a>
              )}
            </>
          }
          tags={
            <RecordTags
              entity="contact"
              recordId={contact.id}
              tags={recordTags.get(contact.id) ?? []}
              allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
            />
          }
        />
      }
      about={<PropertySearch>{about}</PropertySearch>}
      aboutLabel={t('record.layoutTabs.properties')}
      overview={overview}
      activity={activity}
      right={right}
      rightLabel={t('record.layoutTabs.related')}
    />
  );
}
