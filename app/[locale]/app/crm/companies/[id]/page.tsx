import { getTranslations } from 'next-intl/server';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import RelatedLeads from '@/components/crm/RelatedLeads';
import { fieldAccessFor, hiddenFieldsFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { canSeeActivity, canSeeOwner, scopeCompanyDetail, sessionScope, scopeAnd } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { getDb } from '@/lib/db';
import { buildRecordTimeline } from '@/lib/crm-timeline';
import { getCompany, nextTaskFor, parseCustom } from '@/lib/crm';
import { optionHelpersFor } from '@/lib/crm-property-options';
import CrmQuickCreate from '@/components/crm/CrmQuickCreate';
import DangerDelete from '@/components/crm/DangerDelete';
import AssociationPanel from '@/components/crm/AssociationPanel';
import {
  associateContactToCompany,
  removeContactFromCompany,
  associateDealToCompany,
  removeDealFromCompany,
  setCompanyContactLabel,
  setCompanyAsDealPrimary,
  setCompanyParent,
  clearCompanyParent,
  addChildCompany,
  removeChildCompany,
} from '@/components/crm/associationActions';
import { assocLabelOptions, listAssociationLabels } from '@/lib/crm-assoc-labels';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import { formatMoney } from '@/lib/crm-money';
import RecordTags from '@/components/crm/RecordTags';
import { customFieldSections, customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import CrmTrackRequests from '@/components/track/triage/CrmTrackRequests';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView } from '@/lib/crm-files';
import AiSummaryCard from '@/components/crm/AiSummaryCard';
import { crmAiAvailable, getRecordSummary } from '@/lib/crm-ai';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';
import CrmGroupsBlock from '@/components/groups/CrmGroupsBlock';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import RecordColumns, { RecordAssociationSummary, RecordIdentity, RecordRecentCommunications } from '@/components/crm/RecordColumns';
import PropertySearch from '@/components/crm/PropertySearch';
import RecordCard from '@/components/crm/RecordCard';
import RecordWorkflows from '@/components/crm/RecordWorkflows';
import { listRecordEnrollments } from '@/lib/crm-workflows';
import { COMPOSE_TYPES, layoutTabHref, parseCompose, parseLayoutTab, recentCommunications } from '@/components/crm/recordLayout';
import { scopedCompanyRollup, visibleRecordIds } from '@/lib/crm-record-scope';
import CompanyLogo from '@/components/crm/CompanyLogo';
import CompanyEnrichButton from '@/components/crm/CompanyEnrichButton';
import { normalizeCompanyDomain } from '@/lib/crm-domain';
import PhoneTouch from '@/components/crm/PhoneTouch';
import PlaybookLauncher from '@/components/crm/PlaybookLauncher';
import CompanyDuplicatesPanel from '@/components/crm/CompanyDuplicatesPanel';
import { formatPhoneDisplay } from '@/lib/crm-calls';

export const dynamic = 'force-dynamic';

interface CompanyDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CompanyDetailPage(props: CompanyDetailPageProps) {
  const [{ locale, id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tab = parseLayoutTab(searchParams.tab);
  const compose = parseCompose(searchParams.compose);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const crmOpts = await optionHelpersFor(user.id, t);

  const rawDetail = await getCompany(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.company.owner_id, user.id)) notFound();
  const detail = scopeCompanyDetail(rawDetail, scope);
  const { contacts, deals, children } = detail;
  // El valor en deals y la cantidad de hijas, solo con lo que la persona puede ver.
  const rollup = scope ? await scopedCompanyRollup(user.id, detail.company.id, scope) : detail.rollup;
  // La madre y las abuelas vienen sin dueño: se muestran solo las que la persona puede ver
  // (mismo alcance que el resto de la ficha), ni su nombre ni su link si no.
  const companyScope = scopeAnd('crm_companies', scope);
  const visibleAncestorIds = await visibleRecordIds(
    user.id,
    'crm_companies',
    detail.ancestors.map((a) => a.id),
    scope,
  );
  const ancestors = detail.ancestors.filter((a) => visibleAncestorIds.has(a.id));
  const parent = detail.parent && visibleAncestorIds.has(detail.parent.id) ? detail.parent : null;
  // Con una madre que no se le muestra, tampoco se ofrece elegir otra (la pisaría sin verla).
  const parentHidden = !!detail.parent && !parent;
  // Tampoco sale su id en la empresa que va a los componentes.
  const company = parentHidden ? { ...detail.company, parent_company_id: null } : detail.company;
  const base = `/app/crm/companies/${company.id}`;
  const [allTags, recordTags, teamMembers, stageRows, assocLabels] = await Promise.all([
    listTags(user.id),
    tagsForRecords(user.id, 'company', [id]),
    workspaceTeamId(user)
      ? listMembers(workspaceTeamId(user)!)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    // Nombres de stage para los deals relacionados.
    getDb().prepare('SELECT id, name FROM crm_stages').all() as Promise<Array<{ id: string; name: string }>>,
    listAssociationLabels(user.id, 'contact_company'),
  ]);
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const ownerLabel = ownerOptions.find((o) => o.value === (company.owner_id ?? user.id))?.label ?? '—';
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));
  const fmtBase = (n: number) => formatMoney(n, rollup.currency, locale);

  const lifecycleLabel = (v: string): string => crmOpts.label('lifecycle', v);

  const fmtAmount = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const confirmValue = company.domain || company.name;
  // Dominio para completar desde el sitio (el del campo o el del sitio web).
  const siteDomain = normalizeCompanyDomain(company.domain || company.website);
  const socials = (
    [
      ['linkedin', company.linkedin_url],
      ['twitter', company.twitter_url],
      ['facebook', company.facebook_url],
      ['instagram', company.instagram_url],
    ] as const
  ).filter(([, url]) => !!url) as ReadonlyArray<readonly ['linkedin' | 'twitter' | 'facebook' | 'instagram', string]>;

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
    parent_company_id: t('companies.detail.parent'),
    description: t('companiesEnrich.description'),
    founded_year: t('companiesEnrich.foundedYear'),
    linkedin_url: t('companiesEnrich.linkedin'),
    twitter_url: t('companiesEnrich.twitter'),
    facebook_url: t('companiesEnrich.facebook'),
    instagram_url: t('companiesEnrich.instagram'),
  };
  const historyValues: Record<string, Record<string, string>> = {
    lifecycle_stage: crmOpts.labelMap('lifecycle'),
  };

  const activityTypeLabels = Object.fromEntries(COMPOSE_TYPES.map((v) => [v, t(`enums.activityType.${v}`)]));

  const crumbs =
    ancestors.length > 0 ? (
      <nav className="company-crumbs" aria-label={t('companies.detail.hierarchy')}>
        {[...ancestors].reverse().map((a) => (
          <span key={a.id}>
            <Link href={`/app/crm/companies/${a.id}`}>{a.name}</Link>
            <span className="company-crumbs-sep" aria-hidden>
              /
            </span>
          </span>
        ))}
        <span aria-current="page">{company.name}</span>
      </nav>
    ) : null;

  // Los valores para las condiciones del playbook llegan al cliente: sin los campos ocultos.
  const playbookCustom = parseCustom(redactCustomJson(company.custom, await hiddenFieldsFor(sessionFieldViewer(user), 'companies')));

  const actions = (
    <>
      {siteDomain && <CompanyEnrichButton companyId={company.id} domain={siteDomain} enriched={!!company.enriched_at} />}
      {company.phone && <PhoneTouch phone={company.phone} companyId={company.id} name={company.name} />}
      <PlaybookLauncher
        entity="company"
        entityId={company.id}
        values={{
          industry: company.industry,
          employees: company.employees === null || company.employees === undefined ? '' : String(company.employees),
          phone: company.phone,
          city: company.city,
          country: company.country,
          website: company.website,
          lifecycleStage: company.lifecycle_stage,
          ...Object.fromEntries(Object.entries(playbookCustom).map(([k, v]) => [`custom.${k}`, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
        }}
      />
      <CrmQuickCreate
        kind="contact"
        fixedCompanyId={company.id}
        fixedCompanyName={company.name}
        buttonClassName="btn btn-secondary btn-sm"
        label={t('record.createContact')}
      />
      <CrmQuickCreate
        kind="deal"
        fixedCompanyId={company.id}
        fixedCompanyName={company.name}
        buttonClassName="btn btn-secondary btn-sm"
        label={t('record.createDeal')}
      />
      <RecordMoreMenu
        items={[
          {
            key: 'duplicates',
            label: t('record.more.duplicates'),
            title: t('companies.dupes.title'),
            content: <CompanyDuplicatesPanel companyId={company.id} />,
          },
          {
            key: 'history',
            label: t('record.more.history'),
            title: t('history.title'),
            content: (
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
              />
            ),
          },
          {
            key: 'delete',
            label: t('record.more.deleteCompany'),
            title: t('companies.detail.deleteTitle'),
            tone: 'danger',
            content: (
              <DangerDelete
                bare
                endpoint={`/api/crm/companies/${company.id}`}
                confirmToken={confirmValue}
                redirectTo="/app/crm/companies"
                title={t('companies.detail.deleteTitle')}
                desc={t('companies.detail.deleteDesc')}
                buttonLabel={t('companies.detail.deleteButton')}
                confirmLabel={t('record.confirmType', { token: confirmValue })}
                errorLabel={t('errors.generic')}
              />
            ),
          },
        ]}
      />
    </>
  );

  // La ficha carga todo de una vez: las tres columnas están a la vista juntas.
  const contactScope = scopeAnd('crm_contacts', scope);
  const dealScope = scopeAnd('crm_deals', scope);
  // Tareas de chats de Lines que la persona no ve: sin su texto.
  const chatReader = await sessionChatReader(user, locale);
  const [timelinePage, nextTaskRaw, aiAvailable, aiSummaryRaw, recordFilesRaw, fieldAccess, contactRows, allCompanies, allDeals] =
    await Promise.all([
      buildRecordTimeline(user, { kind: 'company', id }, { ownerScope: scope, chatReader }),
      nextTaskFor(user.id, { companyId: id, chatReader }),
      crmAiAvailable(),
      getRecordSummary(user.id, 'company', company.id, scope),
      listRecordFiles(user.id, 'company', company.id),
      fieldAccessFor(sessionFieldViewer(user), 'companies'),
      getDb()
        .prepare(
          `SELECT id, first_name, last_name, email FROM crm_contacts
           WHERE user_id = ?${contactScope.sql} ORDER BY created_at DESC LIMIT 200`,
        )
        .all(user.id, ...contactScope.args) as Promise<
        Array<{ id: string; first_name: string; last_name: string; email: string }>
      >,
      // Empresas del workspace para madre / hijas (sin la propia).
      getDb()
        .prepare(
          `SELECT id, name FROM crm_companies WHERE user_id = ? AND id != ?${companyScope.sql} ORDER BY name COLLATE NOCASE ASC LIMIT 300`,
        )
        .all(user.id, company.id, ...companyScope.args) as Promise<Array<{ id: string; name: string }>>,
      getDb()
        .prepare(`SELECT id, name FROM crm_deals WHERE user_id = ?${dealScope.sql} ORDER BY created_at DESC LIMIT 200`)
        .all(user.id, ...dealScope.args) as Promise<Array<{ id: string; name: string }>>,
    ]);
  // Con alcance restringido (ver la ficha de contacto): próxima tarea y resumen de IA solo si
  // corresponden a lo que la persona ve. Los hilos de email se buscan por los contactos de la
  // empresa: si alguno no se le muestra, no se listan (quedan las actividades de email, que sí
  // respetan el alcance).
  const nextTask = nextTaskRaw && (!scope || (await canSeeActivity(user.id, nextTaskRaw.id, scope))) ? nextTaskRaw : null;
  const aiSummary = scope && aiSummaryRaw?.stale ? null : aiSummaryRaw;
  // Emails solo de los contactos que la persona ve (lib/crm-timeline.ts visibleEmailContacts).
  const timelineItems = timelinePage.items;
  const recordFiles = recordFilesRaw.map(toView);
  const allContacts = contactRows.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
  }));

  // ---------- Izquierda: propiedades, editables en línea ----------
  const customFieldDefs = fieldAccess.visible;
  const custom = parseCustom(redactCustomJson(company.custom, fieldAccess.hidden));
  const customFields = customPropFields(customFieldDefs, custom, {
    yes: t('common.yes'),
    no: t('common.no'),
    locale,
    owners: ownerOptions,
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
    { key: 'phone', label: t('companies.form.phone'), type: 'text', value: company.phone, display: formatPhoneDisplay(company.phone) },
    { key: 'website', label: t('companies.form.website'), type: 'text', value: company.website },
    { key: 'city', label: t('companies.form.city'), type: 'text', value: company.city },
    { key: 'country', label: t('companies.form.country'), type: 'text', value: company.country },
    { key: 'description', label: t('companiesEnrich.description'), type: 'textarea', value: company.description ?? '' },
    {
      key: 'foundedYear',
      label: t('companiesEnrich.foundedYear'),
      type: 'number',
      value: company.founded_year ? String(company.founded_year) : '',
    },
    ...(['linkedin', 'twitter', 'facebook', 'instagram'] as const).map((k): PropField => {
      const value = company[`${k}_url`] ?? '';
      return { key: `${k}Url`, label: t(`companiesEnrich.${k}`), type: 'text', inputType: 'url', value, href: value || undefined };
    }),
    {
      key: 'lifecycleStage',
      label: t('companies.form.lifecycle'),
      type: 'select',
      value: company.lifecycle_stage,
      options: crmOpts.choices('lifecycle', company.lifecycle_stage),
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
  const sections: Array<PropSection & { id: string }> = [
    {
      id: 'about',
      title: t('companies.detail.aboutSection'),
      keys: ['name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'description', 'foundedYear'],
    },
    { id: 'socials', title: t('companiesEnrich.socials'), keys: ['linkedinUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl'] },
    { id: 'lifecycle', title: t('companies.detail.lifecycleSection'), keys: ['lifecycleStage'] },
    { id: 'ownership', title: t('companies.detail.ownershipSection'), keys: ['ownerId'] },
    // Una tarjeta por grupo de propiedades (Ajustes › Datos); las sin grupo, en la de siempre.
    ...customFieldSections(customFieldDefs, customFields, t('companies.detail.customFieldsSection')),
  ];

  const about = (
    <>
      {sections.map((s) => (
        <RecordCard key={s.id} id={`company.${s.id}`} label={s.title}>
          <PropertiesPanel
            endpoint={`/api/crm/companies/${company.id}`}
            fields={fields.filter((f) => s.keys.includes(f.key))}
            custom={custom}
          />
        </RecordCard>
      ))}
      <RecordCard id="company.rollup" label={t('companies.detail.rollup')} testId="company-rollup">
        <dl className="record-facts">
          <div>
            <dt>{t('companies.detail.rollupOpen')}</dt>
            <dd className="num">{fmtBase(rollup.own.open)}</dd>
          </div>
          <div>
            <dt>{t('companies.detail.rollupWon')}</dt>
            <dd className="num">{fmtBase(rollup.own.won)}</dd>
          </div>
        </dl>
        {rollup.childCount > 0 && (
          <>
            <p className="rollup-sub">{t('companies.detail.rollupTree', { count: rollup.childCount })}</p>
            <dl className="record-facts">
              <div>
                <dt>{t('companies.detail.rollupOpen')}</dt>
                <dd className="num">{fmtBase(rollup.total.open)}</dd>
              </div>
              <div>
                <dt>{t('companies.detail.rollupWon')}</dt>
                <dd className="num">{fmtBase(rollup.total.won)}</dd>
              </div>
              <div>
                <dt>{t('companies.detail.rollupDeals')}</dt>
                <dd className="num">{rollup.total.count}</dd>
              </div>
            </dl>
          </>
        )}
        <p className="ui-help">{t('companies.detail.rollupNote', { currency: rollup.currency })}</p>
      </RecordCard>
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
        {company.description && (
          <p className="co-about" data-testid="company-description">
            {company.description}
          </p>
        )}
        <dl className="record-facts">
          <div>
            <dt>{t('companies.form.owner')}</dt>
            <dd>{ownerLabel}</dd>
          </div>
          <div>
            <dt>{t('companies.form.employees')}</dt>
            <dd className="num">{company.employees ?? '—'}</dd>
          </div>
          {company.founded_year ? (
            <div>
              <dt>{t('companiesEnrich.foundedYear')}</dt>
              <dd className="num">{company.founded_year}</dd>
            </div>
          ) : null}
          {socials.length > 0 && (
            <div>
              <dt>{t('companiesEnrich.socials')}</dt>
              <dd className="co-socials">
                {socials.map(([key, url]) => (
                  <a key={key} href={url} target="_blank" rel="noopener noreferrer">
                    {t(`companiesEnrich.${key}`)}
                  </a>
                ))}
              </dd>
            </div>
          )}
          <div>
            <dt>{t('companies.detail.rollupOpen')}</dt>
            <dd className="num">{fmtBase(rollup.own.open)}</dd>
          </div>
          <div>
            <dt>{t('companies.detail.rollupWon')}</dt>
            <dd className="num">{fmtBase(rollup.own.won)}</dd>
          </div>
          <ActivityDateFacts record={company} locale={locale} />
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
        testId="record-summary-contacts"
        title={t('companies.detail.contacts')}
        rows={contacts.map((c) => ({
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
          href: `/app/crm/contacts/${c.id}`,
          meta: c.email || undefined,
        }))}
        emptyLabel={t('companies.detail.noContacts')}
        moreLabel={t('record.moreCount', { count: Math.max(contacts.length - 5, 0) })}
      />
      <RecordAssociationSummary
        testId="record-summary-deals"
        title={t('companies.detail.deals')}
        rows={deals.map((d) => ({
          id: d.id,
          name: d.name,
          href: `/app/crm/deals/${d.id}`,
          meta: `${stageName.get(d.stage_id) ?? '—'} · ${fmtAmount(d.amount, d.currency)}`,
        }))}
        emptyLabel={t('companies.detail.noDeals')}
        moreLabel={t('record.moreCount', { count: Math.max(deals.length - 5, 0) })}
      />
    </>
  );

  const activity = (
    <>
      {nextTaskBanner}
      <Timeline
        recordType="company"
        recordId={company.id}
        items={timelineItems}
        hasMore={timelinePage.hasMore}
        currentPersonId={user.actingUser?.id ?? user.id}
        emptyLabel={t('companies.detail.emptyTimeline')}
        mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
        locale={locale}
        compose={compose}
      />
    </>
  );

  // ---------- Derecha: asociaciones ----------
  // La persona ya ve la empresa (notFound arriba si no): sus inscripciones en workflows.
  const workflowEnrollments = await listRecordEnrollments(user.id, 'company', company.id, 20, sessionFieldViewer(user));

  const right = (
    <>
      <RecordCard id="company.ai" label={t('ai.summary.title')} bare>
        <AiSummaryCard entity="company" id={company.id} locale={locale} initial={aiSummary} available={aiAvailable} />
      </RecordCard>

      <RecordCard
        id="company.contacts"
        label={t('companies.detail.contacts')}
        count={contacts.length}
        addLabel={t('record.cards.add')}
        addAlways
      >
        <AssociationPanel
          searchType="contact"
          records={contacts.map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            href: `/app/crm/contacts/${c.id}`,
            meta:
              [c.email, c.is_primary ? '' : t('companies.detail.notPrimaryCompany')].filter(Boolean).join(' · ') ||
              undefined,
            label: c.label,
          }))}
          onSetLabel={setCompanyContactLabel.bind(null, company.id)}
          labelOptions={assocLabelOptions('contact_company', assocLabels, (k) => t(`enums.contactCompanyLabel.${k}`))}
          options={allContacts
            .filter((c) => !contacts.some((cc) => cc.id === c.id))
            .map((c) => ({ id: c.id, value: c.name }))}
          onAssociate={associateContactToCompany.bind(null, company.id)}
          onRemove={removeContactFromCompany.bind(null, company.id)}
          addLabel={t('assoc.pickContact')}
          emptyLabel={t('companies.detail.noContacts')}
        />
      </RecordCard>

      <RecordCard
        id="company.deals"
        label={t('companies.detail.deals')}
        count={deals.length}
        addLabel={t('record.cards.add')}
        addAlways
      >
        <AssociationPanel
          searchType="deal"
          records={deals.map((d) => ({
            id: d.id,
            name: d.name,
            href: `/app/crm/deals/${d.id}`,
            meta: `${stageName.get(d.stage_id) ?? '—'} · ${fmtAmount(d.amount, d.currency)}`,
            primary: !!d.is_primary,
          }))}
          onSetPrimary={setCompanyAsDealPrimary.bind(null, company.id)}
          options={allDeals
            .filter((d) => !deals.some((dd) => dd.id === d.id))
            .map((d) => ({ id: d.id, value: d.name }))}
          onAssociate={associateDealToCompany.bind(null, company.id)}
          onRemove={removeDealFromCompany.bind(null, company.id)}
          addLabel={t('assoc.pickDeal')}
          emptyLabel={t('companies.detail.noDeals')}
        />
      </RecordCard>

      <RecordCard id="company.parent" label={t('companies.detail.parent')} addLabel={parent || parentHidden || allCompanies.length === 0 ? undefined : t('record.cards.add')}>
        <AssociationPanel
          records={parent ? [{ id: parent.id, name: parent.name, href: `/app/crm/companies/${parent.id}` }] : []}
          options={parent || parentHidden ? [] : allCompanies.map((c) => ({ id: c.id, value: c.name }))}
          onAssociate={setCompanyParent.bind(null, company.id)}
          onRemove={clearCompanyParent.bind(null, company.id)}
          addLabel={t('companies.detail.pickParent')}
          emptyLabel={t('companies.detail.noParent')}
        />
      </RecordCard>

      <RecordCard
        id="company.children"
        label={t('companies.detail.children')}
        count={children.length}
        addLabel={t('record.cards.add')}
        addAlways
      >
        <AssociationPanel
          searchType="company"
          exclude={[company.id, ...(parent ? [parent.id] : [])]}
          records={children.map((c) => ({
            id: c.id,
            name: c.name,
            href: `/app/crm/companies/${c.id}`,
            meta: c.domain || undefined,
          }))}
          options={allCompanies
            .filter((c) => c.id !== parent?.id && !children.some((ch) => ch.id === c.id))
            .map((c) => ({ id: c.id, value: c.name }))}
          onAssociate={addChildCompany.bind(null, company.id)}
          onRemove={removeChildCompany.bind(null, company.id)}
          addLabel={t('companies.detail.pickChild')}
          emptyLabel={t('companies.detail.noChildren')}
        />
      </RecordCard>

      <RecordCard id="company.files" label={t('files.title')} count={recordFiles.length}>
        <FilesPanel endpoint={`/api/crm/companies/${company.id}/files`} files={recordFiles} />
      </RecordCard>

      <RecordCard id="company.leads" label={t('leads.contactLeads')} bare>
        <RelatedLeads
          workspaceId={user.id}
          companyId={company.id}
          companyName={company.name}
          scope={scope}
          locale={locale}
          owners={ownerOptions}
          defaultOwner={realUserId(user)}
        />
      </RecordCard>
      <RelatedObjectRecords workspaceId={user.id} entity="company" entityId={company.id} scope={scope} locale={locale} />
      <RecordCard id="company.groups" label={t('record.cards.groups')} bare>
        <CrmGroupsBlock ws={user.id} kind="company" recordId={company.id} locale={locale} me={user.actingUser?.id ?? user.id} role={user.role} />
      </RecordCard>
      <RecordCard id="company.track" label={t('record.cards.track')} bare>
        <CrmTrackRequests companyId={company.id} locale={locale} />
      </RecordCard>
      <RecordCard id="company.workflows" label={t('workflows.recordCard.title')} count={workflowEnrollments.length}>
        <RecordWorkflows enrollments={workflowEnrollments} canEdit={isWorkspaceAdmin(user)} />
      </RecordCard>
    </>
  );

  return (
    <RecordColumns
      tab={tab}
      base={base}
      back={{ href: '/app/crm/companies', label: t('record.back.companies') }}
      before={crumbs}
      actions={actions}
      identity={
        <RecordIdentity
          name={company.name}
          avatar={<CompanyLogo domain={company.domain} name={company.name} size={40} />}
          quick={COMPOSE_TYPES}
          keyLine={
            <>
              <span className={`dot-label stage-${company.lifecycle_stage}`}>{lifecycleLabel(company.lifecycle_stage)}</span>
              {company.domain && (
                <a
                  className="record-meta-link data"
                  href={`https://${company.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {company.domain}
                </a>
              )}
              {company.industry && <span>{company.industry}</span>}
              {(company.city || company.country) && <span>{[company.city, company.country].filter(Boolean).join(', ')}</span>}
            </>
          }
          tags={
            <RecordTags
              entity="company"
              recordId={company.id}
              tags={recordTags.get(company.id) ?? []}
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
