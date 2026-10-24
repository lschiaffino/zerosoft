import { getTranslations } from 'next-intl/server';
import RelatedObjectRecords from '@/components/crm/RelatedObjectRecords';
import RelatedLeads from '@/components/crm/RelatedLeads';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import ActivityDateFacts from '@/components/crm/ActivityDateFacts';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { canSeeOwner, scopeCompanyDetail, sessionScope, scopeAnd } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { listEmailThreads, mergeTimelineWithThreads } from '@/lib/crm-email';
import { getCompany, LIFECYCLE_STAGES, listTimeline, nextTaskFor, parseCustom } from '@/lib/crm';
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
import { CONTACT_COMPANY_LABELS } from '@/lib/crm-constants';
import { listTags, tagsForRecords } from '@/lib/crm-tags';
import { formatMoney } from '@/lib/crm-money';
import RecordTags from '@/components/crm/RecordTags';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';
import FilesPanel from '@/components/crm/FilesPanel';
import { listRecordFiles, toView, withActivityFiles } from '@/lib/crm-files';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import HistoryPanel from '@/components/crm/HistoryPanel';
import { listMembers } from '@/lib/teams';
import PageHeader from '@/components/ui/PageHeader';
import CrmGroupsBlock from '@/components/groups/CrmGroupsBlock';
import RecordTabs from '@/components/crm/RecordTabs';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import CompanyLogo from '@/components/crm/CompanyLogo';
import CompanyEnrichButton from '@/components/crm/CompanyEnrichButton';
import { normalizeCompanyDomain } from '@/lib/crm-domain';
import PhoneTouch from '@/components/crm/PhoneTouch';
import CompanyDuplicatesPanel from '@/components/crm/CompanyDuplicatesPanel';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';

export const dynamic = 'force-dynamic';

interface CompanyDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CompanyDetailPage(props: CompanyDetailPageProps) {
  const [{ locale, id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const tab = parseRecordTab(searchParams.tab);

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const rawDetail = await getCompany(user.id, id);
  if (!rawDetail || !canSeeOwner(scope, rawDetail.company.owner_id, user.id)) notFound();
  const detail = scopeCompanyDetail(rawDetail, scope);
  const { company, contacts, deals, parent, ancestors, children, rollup } = detail;
  const base = `/app/crm/companies/${company.id}`;
  const [allTags, recordTags, teamMembers, stageRows] = await Promise.all([
    listTags(user.id),
    tagsForRecords(user.id, 'company', [id]),
    user.team?.id
      ? listMembers(user.team.id)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    // Nombres de stage para los deals relacionados.
    getDb().prepare('SELECT id, name FROM crm_stages').all() as Promise<Array<{ id: string; name: string }>>,
  ]);
  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const ownerLabel = ownerOptions.find((o) => o.value === (company.owner_id ?? user.id))?.label ?? '—';
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));
  const fmtBase = (n: number) => formatMoney(n, rollup.currency, locale);

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

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
    lifecycle_stage: Object.fromEntries(LIFECYCLE_STAGES.map((v) => [v, t(`enums.lifecycle.${v}`)])),
  };

  const header = (
    <>
      {ancestors.length > 0 && (
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
      )}
      <PageHeader
        back={{ href: '/app/crm/companies', label: t('record.back.companies') }}
        title={
          <span className="record-title-logo">
            <CompanyLogo domain={company.domain} name={company.name} size={28} />
            {company.name}
          </span>
        }
        description={
          <span className="record-meta">
            <span className={`badge stage-${company.lifecycle_stage}`}>{lifecycleLabel(company.lifecycle_stage)}</span>
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
          </span>
        }
        actions={
          <>
            {siteDomain && <CompanyEnrichButton companyId={company.id} domain={siteDomain} enriched={!!company.enriched_at} />}
            {company.phone && <PhoneTouch phone={company.phone} companyId={company.id} />}
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
        }
      />
      <RecordTags
        entity="company"
        recordId={company.id}
        tags={recordTags.get(company.id) ?? []}
        allTags={allTags.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
      />
    </>
  );

  // ---------- Actividad ----------
  if (tab === 'activity') {
    const [timeline, threads, nextTask] = await Promise.all([
      listTimeline(user.id, { companyId: id, limit: 100, ownerScope: scope }),
      listEmailThreads(user.id, { companyId: id, limit: 100 }),
      nextTaskFor(user.id, { companyId: id }),
    ]);
    const timelineItems = await withActivityFiles(mergeTimelineWithThreads(timeline, threads));
    const recordFiles = (await listRecordFiles(user.id, 'company', company.id)).map(toView);
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
                recordType="company"
                recordId={company.id}
                items={timelineItems}
                emptyLabel={t('companies.detail.emptyTimeline')}
                mentionables={teamMembers.map((m) => ({ id: m.user_id, name: m.name, email: m.email }))}
                locale={locale}
              />
            </div>
            <aside className="record-summary" aria-label={t('record.summary')}>
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
              <Link href={recordTabHref(base, 'properties')} className="record-summary-more">
                {t('companies.detail.viewAllProperties')}
              </Link>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('companies.detail.deals')} <span className="num">{deals.length}</span>
                </h2>
                {deals.length === 0 ? (
                  <p className="muted">{t('companies.detail.noDeals')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {deals.slice(0, 5).map((d) => (
                      <li key={d.id}>
                        <Link href={`/app/crm/deals/${d.id}`}>{d.name}</Link>
                        <span className="muted">
                          {stageName.get(d.stage_id) ?? '—'} · <span className="num">{fmtAmount(d.amount, d.currency)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="record-summary-block">
                <h2 className="record-summary-title">
                  {t('companies.detail.contacts')} <span className="num">{contacts.length}</span>
                </h2>
                {contacts.length === 0 ? (
                  <p className="muted">{t('companies.detail.noContacts')}</p>
                ) : (
                  <ul className="record-summary-list">
                    {contacts.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <Link href={`/app/crm/contacts/${c.id}`}>
                          {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}
                        </Link>
                        {c.email && <span className="muted">{c.email}</span>}
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
                <FilesPanel endpoint={`/api/crm/companies/${company.id}/files`} files={recordFiles} />
              </div>
              <CrmGroupsBlock ws={user.id} kind="company" recordId={company.id} locale={locale} />
            </aside>
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Propiedades ----------
  if (tab === 'properties') {
    const fieldAccess = await fieldAccessFor(sessionFieldViewer(user), 'companies');
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
      { key: 'phone', label: t('companies.form.phone'), type: 'text', value: company.phone },
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
        keys: ['name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'description', 'foundedYear'],
      },
      { title: t('companiesEnrich.socials'), keys: ['linkedinUrl', 'twitterUrl', 'facebookUrl', 'instagramUrl'] },
      { title: t('companies.detail.lifecycleSection'), keys: ['lifecycleStage'] },
      { title: t('companies.detail.ownershipSection'), keys: ['ownerId'] },
      ...(customFields.length
        ? [{ title: t('companies.detail.customFieldsSection'), keys: customFields.map((f) => f.key) }]
        : []),
    ];
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-props">
            <PropertiesPanel
              endpoint={`/api/crm/companies/${company.id}`}
              fields={fields}
              custom={custom}
              sections={sections}
            />
            <section className="record-block" data-testid="company-rollup">
              <div className="assoc-head">
                <h2 className="assoc-title">{t('companies.detail.rollup')}</h2>
              </div>
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
            </section>
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Relacionados ----------
  const [contactRows, allCompanies, allDeals] = await Promise.all([
    getDb()
      .prepare(
        `SELECT id, first_name, last_name, email FROM crm_contacts
         WHERE user_id = ?${scopeAnd('crm_contacts', scope).sql} ORDER BY created_at DESC LIMIT 200`,
      )
      .all(user.id, ...scopeAnd('crm_contacts', scope).args) as Promise<
      Array<{ id: string; first_name: string; last_name: string; email: string }>
    >,
    // Empresas del workspace para madre / hijas (sin la propia).
    getDb()
      .prepare(
        `SELECT id, name FROM crm_companies WHERE user_id = ? AND id != ?${scopeAnd('crm_companies', scope).sql} ORDER BY name COLLATE NOCASE ASC LIMIT 300`,
      )
      .all(user.id, company.id, ...scopeAnd('crm_companies', scope).args) as Promise<Array<{ id: string; name: string }>>,
    getDb()
      .prepare(`SELECT id, name FROM crm_deals WHERE user_id = ?${scopeAnd('crm_deals', scope).sql} ORDER BY created_at DESC LIMIT 200`)
      .all(user.id, ...scopeAnd('crm_deals', scope).args) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const allContacts = contactRows.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
  }));

  return (
    <div className="ui-page record-page">
      {header}
      <RecordTabs>
        <div className="record-related">
          <section className="record-block">
            <AssociationPanel
              title={t('companies.detail.contacts')}
              count={contacts.length}
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
              labelOptions={CONTACT_COMPANY_LABELS.map((v) => ({ value: v, label: t(`enums.contactCompanyLabel.${v}`) }))}
              options={allContacts
                .filter((c) => !contacts.some((cc) => cc.id === c.id))
                .map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateContactToCompany.bind(null, company.id)}
              onRemove={removeContactFromCompany.bind(null, company.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('companies.detail.noContacts')}
            />
          </section>

          <section className="record-block">
            <AssociationPanel
              title={t('companies.detail.deals')}
              count={deals.length}
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
          </section>

          <section className="record-block">
            <AssociationPanel
              title={t('companies.detail.parent')}
              records={parent ? [{ id: parent.id, name: parent.name, href: `/app/crm/companies/${parent.id}` }] : []}
              options={parent ? [] : allCompanies.map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={setCompanyParent.bind(null, company.id)}
              onRemove={clearCompanyParent.bind(null, company.id)}
              addLabel={t('companies.detail.pickParent')}
              emptyLabel={t('companies.detail.noParent')}
            />
          </section>

          <section className="record-block">
            <AssociationPanel
              title={t('companies.detail.children')}
              count={children.length}
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
          </section>
          <RelatedLeads
            workspaceId={user.id}
            companyId={company.id}
            companyName={company.name}
            scope={scope}
            locale={locale}
            owners={ownerOptions}
            defaultOwner={realUserId(user)}
          />
          <RelatedObjectRecords workspaceId={user.id} entity="company" entityId={company.id} scope={scope} locale={locale} />
        </div>
      </RecordTabs>
    </div>
  );
}
