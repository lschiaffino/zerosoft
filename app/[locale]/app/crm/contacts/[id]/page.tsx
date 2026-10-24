import { notFound } from 'next/navigation';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import RelatedLeads from '@/components/crm/RelatedLeads';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { canSeeOwner, ownerScopeSql, scopeContactDetail, sessionScope } from '@/lib/crm-visibility';
import { scoreTier } from '@/lib/crm-scoring-schema';
import { contactScores, listScores } from '@/lib/crm-scoring';
import { getDb } from '@/lib/db';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  PRIORITIES,
  SOURCES,
  getContact,
  listCompanies,
  listPipelinesWithStages,
  listTimeline,
  nextTaskFor,
  parseCustom,
} from '@/lib/crm';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView, withActivityFiles } from '@/lib/crm-files';
import AiSummaryCard from '@/components/crm/AiSummaryCard';
import { crmAiAvailable, getRecordSummary, withCallSummaries } from '@/lib/crm-ai';
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
import { listEmailThreads, mergeTimelineWithThreads, getEmailSettings, listEmailTemplates } from '@/lib/crm-email';
import { listEnrollments, listSequences } from '@/lib/crm-sequences';
import { aiEnabled } from '@/lib/ai';
import { CONTACT_COMPANY_LABELS } from '@/lib/crm-constants';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import RecordTags from '@/components/crm/RecordTags';
import PageHeader from '@/components/ui/PageHeader';
import CrmGroupsBlock from '@/components/groups/CrmGroupsBlock';
import RecordTabs from '@/components/crm/RecordTabs';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';

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
  const tab = parseRecordTab(searchParams.tab);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const rawDetail = await getContact(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.contact.owner_id, user.id)) notFound();
  const detail = scopeContactDetail(rawDetail, scope);

  const { contact, company, companies: contactCompanies, deals, lists } = detail;
  const base = `/app/crm/contacts/${contact.id}`;
  const [allTags, recordTags, teamMembers, eventTypes] = await Promise.all([
    listTags(user.id),
    tagsForRecords(user.id, 'contact', [id]),
    user.team?.id
      ? listMembers(user.team.id)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    listEventTypes(user.id, { activeOnly: true }),
  ]);
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

  const header = (
    <>
      <PageHeader
        back={{ href: '/app/crm/contacts', label: t('record.back.contacts') }}
        title={name}
        description={
          <span className="record-meta">
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
          </span>
        }
        actions={
          <>
            {contact.phone && <PhoneTouch phone={contact.phone} contactId={contact.id} />}
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
                ...Object.fromEntries(Object.entries(parseCustom(contact.custom)).map(([k, v]) => [`custom.${k}`, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
              }}
            />
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
                  content: <DuplicatesPanel contactId={contact.id} autoFind />,
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
        }
      />
      <RecordTags
        entity="contact"
        recordId={contact.id}
        tags={recordTags.get(contact.id) ?? []}
        allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
      />
    </>
  );

  // ---------- Actividad: timeline + resumen a la derecha ----------
  if (tab === 'activity') {
    const primaryScore = (await listScores(user.id)).find((x) => x.isPrimary);
    const primaryTier = primaryScore ? scoreTier(contact.score ?? 0, primaryScore.thresholds) : null;
    const [timeline, threads, emailTemplates, emailSettings, nextTask] = await Promise.all([
      listTimeline(user.id, { contactId: id, limit: 100, ownerScope: scope }),
      listEmailThreads(user.id, { contactId: id, limit: 100 }),
      listEmailTemplates(user.id),
      getEmailSettings(user.id),
      nextTaskFor(user.id, { contactId: id }),
    ]);
    const timelineItems = await withCallSummaries(user.id, await withActivityFiles(mergeTimelineWithThreads(timeline, threads)));
    const [aiAvailable, aiSummary] = await Promise.all([crmAiAvailable(), getRecordSummary(user.id, 'contact', contact.id, scope)]);
    const recordFiles = (await listRecordFiles(user.id, 'contact', contact.id)).map(toView);
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
                recordType="contact"
                recordId={contact.id}
                items={timelineItems}
                emptyLabel={t('contacts.detail.emptyTimeline')}
                mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
                locale={locale}
                defaultEmail={contact.email}
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
            </div>
            <aside className="record-summary" aria-label={t('record.summary')}>
              <AiSummaryCard entity="contact" id={contact.id} locale={locale} initial={aiSummary} available={aiAvailable} />
              <dl className="record-facts">
                <div>
                  <dt>{t('contacts.form.email')}</dt>
                  <dd>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : '—'}</dd>
                </div>
                <div>
                  <dt>{t('contacts.form.phone')}</dt>
                  <dd>
                    {contact.phone ? (
                      <a href={`tel:${contact.phone}`} className="num">
                        {contact.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
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
              <Link href={recordTabHref(base, 'properties')} className="record-summary-more">
                {t('contacts.detail.viewAllProperties')}
              </Link>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('contacts.detail.deals')} <span className="num">{deals.length}</span>
                </h2>
                {deals.length === 0 ? (
                  <p className="muted">{t('contacts.detail.noDeals')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {deals.slice(0, 5).map((d) => (
                      <li key={d.id}>
                        <Link href={`/app/crm/deals/${d.id}`}>{d.name}</Link>
                        <span className="muted">
                          {d.stage_name ? `${d.stage_name} · ` : ''}
                          <span className="num">{money(d.amount, d.currency, locale)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('contacts.detail.companies')} <span className="num">{contactCompanies.length}</span>
                </h2>
                {contactCompanies.length === 0 ? (
                  <p className="muted">{t('contacts.detail.noCompany')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {contactCompanies.slice(0, 5).map((c) => (
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
                <FilesPanel endpoint={`/api/crm/contacts/${contact.id}/files`} files={recordFiles} />
              </div>
              <CrmGroupsBlock ws={user.id} kind="contact" recordId={contact.id} locale={locale} />
            </aside>
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Propiedades: todas, editables en línea, + score ----------
  if (tab === 'properties') {
    const [companiesPage, fieldAccess] = await Promise.all([
      listCompanies(user.id, { pageSize: 100, sort: 'name', ownerScope: scope }),
      fieldAccessFor(sessionFieldViewer(user), 'contacts'),
    ]);
    const companies = companiesPage.rows;
    const customFieldDefs = fieldAccess.visible;
    const custom = parseCustom(redactCustomJson(contact.custom, fieldAccess.hidden));
    const customFields = customPropFields(customFieldDefs, custom, {
      yes: t('common.yes'),
      no: t('common.no'),
      locale,
      owners: ownerOptions,
    });
    const scoreViews = await contactScores(user.id, contact);
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
      ...customFields,
    ];
    const sections: PropSection[] = [
      {
        title: t('contacts.detail.aboutSection'),
        keys: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'website', 'city', 'country'],
      },
      { title: t('contacts.detail.lifecycleSection'), keys: ['lifecycleStage', 'leadStatus', 'source'] },
      { title: t('contacts.detail.ownershipSection'), keys: ['ownerId', 'companyId'] },
      ...(customFields.length
        ? [{ title: t('contacts.detail.customFieldsSection'), keys: customFields.map((f) => f.key) }]
        : []),
    ];
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-props">
            <PropertiesPanel
              endpoint={`/api/crm/contacts/${contact.id}`}
              fields={fields}
              custom={custom}
              sections={sections}
            />
            {scoreViews.map((sv) => (
              <section
                key={sv.scoreId}
                className="record-block score-card"
                id={sv.isPrimary ? 'score' : `score-${sv.scoreId}`}
                data-testid="contact-score-card"
              >
                <div className="assoc-head">
                  <h2 className="assoc-title">{sv.name}</h2>
                  <span className="num score-card-value">{sv.score}</span>
                  {sv.tier && (
                    <span className="score-tier" data-testid="score-card-tier">
                      {sv.tier}
                    </span>
                  )}
                </div>
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
              </section>
            ))}
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Relacionados: empresas, deals, secuencias, listas ----------
  const dealScope = ownerScopeSql('d', scope);
  const [companiesPage, allDeals, enrollments, sequences, pipelines] = await Promise.all([
    listCompanies(user.id, { pageSize: 100, sort: 'name', ownerScope: scope }),
    getDb()
      .prepare(
        `SELECT d.id, d.name FROM crm_deals d WHERE d.user_id = ?${dealScope.sql ? ` AND ${dealScope.sql}` : ''}
         ORDER BY d.created_at DESC LIMIT 200`,
      )
      .all(user.id, ...dealScope.args) as Promise<Array<{ id: string; name: string }>>,
    listEnrollments(user.id, { contactId: id, limit: 20 }),
    listSequences(user.id),
    listPipelinesWithStages(user.id),
  ]);
  const companies = companiesPage.rows;
  // Pipeline default + primer stage abierto (para crear deals desde el detalle).
  const defaultPipeline = pipelines[0];
  const firstOpenStage =
    defaultPipeline?.stages.find((s) => !s.is_won && !s.is_lost) ?? defaultPipeline?.stages[0];
  const priorities = PRIORITIES.map((value) => ({ value, label: t(`enums.priority.${value}`) }));
  const sourceOpts = SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }));

  return (
    <div className="ui-page record-page">
      {header}
      <RecordTabs>
        <div className="record-related">
          <section className="record-block">
            <AssociationPanel
              title={t('contacts.detail.companies')}
              count={contactCompanies.length}
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
              labelOptions={CONTACT_COMPANY_LABELS.map((v) => ({
                value: v,
                label: t(`enums.contactCompanyLabel.${v}`),
              }))}
              addLabel={t('contacts.detail.associateCompany')}
              emptyLabel={t('contacts.detail.noCompany')}
              action={<CompanyQuickCreate contactId={contact.id} />}
            />
          </section>

          <section className="record-block">
            <AssociationPanel
              title={t('contacts.detail.deals')}
              count={deals.length}
              records={deals.map((d) => ({
                id: d.id,
                name: d.name,
                href: `/app/crm/deals/${d.id}`,
                meta: [d.stage_name, money(d.amount, d.currency, locale)].filter(Boolean).join(' · '),
              }))}
              options={allDeals
                .filter((d) => !deals.some((dd) => dd.id === d.id))
                .map((d) => ({ id: d.id, value: d.name }))}
              onAssociate={associateDealToContact.bind(null, contact.id)}
              onRemove={removeDealFromContact.bind(null, contact.id)}
              addLabel={t('assoc.pickDeal')}
              emptyLabel={t('contacts.detail.noDeals')}
              action={
                defaultPipeline && firstOpenStage ? (
                  <ContactAddDeal
                    pipelineId={defaultPipeline.id}
                    stageId={firstOpenStage.id}
                    contactId={contact.id}
                    priorities={priorities}
                    sources={sourceOpts}
                  />
                ) : undefined
              }
            />
          </section>

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

          <section className="record-block">
            <div className="assoc-head">
              <h2 className="assoc-title">{t('contacts.detail.lists')}</h2>
              <span className="assoc-count num">{lists.length}</span>
            </div>
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
          </section>
          <RelatedLeads
            workspaceId={user.id}
            contactId={contact.id}
            contactName={[contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email}
            scope={scope}
            locale={locale}
            owners={ownerOptions}
            defaultOwner={realUserId(user)}
          />
          <RelatedObjectRecords workspaceId={user.id} entity="contact" entityId={contact.id} scope={scope} locale={locale} />
        </div>
      </RecordTabs>
    </div>
  );
}

