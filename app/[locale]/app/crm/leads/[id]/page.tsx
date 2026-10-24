import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { canSeeOwner, scopeAnd, sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { ensureLeadStages, getLead } from '@/lib/crm-leads';
import { listPipelinesWithStages, listTimeline, parseCustom } from '@/lib/crm';
import { getCrmSettings } from '@/lib/crm-currency';
import { SOURCES } from '@/lib/crm-constants';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import { ownerOptions } from '@/lib/crm-owners';
import { withActivityFiles } from '@/lib/crm-files';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import RecordTabs from '@/components/crm/RecordTabs';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import RecordTitle from '@/components/crm/RecordTitle';
import DangerDelete from '@/components/crm/DangerDelete';
import Timeline from '@/components/crm/Timeline';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import AssociationPanel from '@/components/crm/AssociationPanel';
import LeadActions, { LeadStagePath } from '@/components/crm/LeadActions';
import { customPropFields } from '@/components/crm/customPropFields';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';
import { clearLeadCompany, clearLeadContact, setLeadCompany, setLeadContact } from '@/components/crm/leadServerActions';

export const dynamic = 'force-dynamic';

/** Ficha de un lead: etapa, conversión a deal, timeline, propiedades y contacto/empresa. */
export default async function LeadPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const tab = parseRecordTab(sp.tab);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = await sessionScope(user);
  const lead = await getLead(user.id, id);
  if (!lead || !canSeeOwner(scope, lead.owner_id, user.id)) notFound();

  const base = `/app/crm/leads/${lead.id}`;
  const [stages, owners] = await Promise.all([ensureLeadStages(user.id), ownerOptions(user)]);
  const ownerLabel = owners.find((o) => o.value === (lead.owner_id ?? user.id))?.label ?? '—';
  const stage = stages.find((s) => s.id === lead.stage_id);
  const kind = stage?.kind ?? 'open';

  let actions: React.ReactNode;
  {
    const [pipelines, settings] = await Promise.all([listPipelinesWithStages(user.id), getCrmSettings(user.id)]);
    actions = (
      <>
        <LeadActions
          leadId={lead.id}
          leadName={lead.name}
          dealId={lead.deal_id}
          stageKind={kind}
          disqualifiedStageId={stages.find((s) => s.kind === 'disqualified')?.id ?? null}
          firstOpenStageId={stages.find((s) => s.kind === 'open')?.id ?? null}
          pipelines={pipelines.map((p) => ({
            id: p.id,
            name: p.name,
            stages: p.stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost })),
          }))}
          currency={settings.baseCurrency}
        />
        <RecordMoreMenu
          items={[
            {
              key: 'delete',
              label: t('leads.deleteButton'),
              title: t('leads.deleteTitle'),
              tone: 'danger',
              content: (
                <DangerDelete
                  bare
                  endpoint={`/api/crm/leads/${lead.id}`}
                  confirmToken={lead.name}
                  redirectTo="/app/crm/leads"
                  title={t('leads.deleteTitle')}
                  desc={t('leads.deleteDesc')}
                  buttonLabel={t('leads.deleteButton')}
                  confirmLabel={t('record.confirmType', { token: lead.name })}
                  errorLabel={t('errors.generic')}
                />
              ),
            },
          ]}
        />
      </>
    );
  }

  const header = (
    <>
      <PageHeader
        back={{ href: '/app/crm/leads', label: t('leads.back') }}
        title={<RecordTitle name={lead.name} endpoint={`/api/crm/leads/${lead.id}`} />}
        description={
          <span className="record-meta">
            <span className={`badge lead-kind-${kind}`}>{stage?.name ?? '—'}</span>
            {lead.contact_id && <Link href={`/app/crm/contacts/${lead.contact_id}`}>{lead.contact_name ?? lead.contact_email}</Link>}
            {lead.company_id && <Link href={`/app/crm/companies/${lead.company_id}`}>{lead.company_name}</Link>}
            <span>{ownerLabel}</span>
            {lead.converted_at && <span>{t('leads.converted', { date: formatDate(lead.converted_at, locale) })}</span>}
            {kind === 'disqualified' && lead.disqualify_reason && (
              <span>{t('leads.disqualify.reasonLabel', { reason: lead.disqualify_reason })}</span>
            )}
          </span>
        }
        actions={actions}
      />
      <LeadStagePath leadId={lead.id} stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))} current={lead.stage_id} />
    </>
  );

  if (tab === 'activity') {
    const timeline = await listTimeline(user.id, { leadId: lead.id, limit: 100 });
    const items = await withActivityFiles(timeline);
    const open = timeline
      .filter((a) => a.type === 'task' && !a.done)
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))[0];
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-activity">
            <div className="record-activity-main">
              <NextTaskBanner task={open ? { id: open.id, subject: open.subject, due_at: open.due_at } : null} locale={locale} />
              <Timeline
                recordType="lead"
                recordId={lead.id}
                items={items}
                emptyLabel={t('leads.emptyTimeline')}
                mentionables={owners.map((o) => ({ id: o.value, name: o.label, email: '' }))}
                locale={locale}
              />
            </div>
            <aside className="record-summary" aria-label={t('record.summary')}>
              <dl className="record-facts">
                <div>
                  <dt>{t('leads.columns.owner')}</dt>
                  <dd>{ownerLabel}</dd>
                </div>
                <div>
                  <dt>{t('leads.summaryContact')}</dt>
                  <dd>
                    {lead.contact_id ? (
                      <Link href={`/app/crm/contacts/${lead.contact_id}`}>{lead.contact_name ?? lead.contact_email}</Link>
                    ) : (
                      t('leads.none')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('leads.summaryCompany')}</dt>
                  <dd>
                    {lead.company_id ? <Link href={`/app/crm/companies/${lead.company_id}`}>{lead.company_name}</Link> : t('leads.none')}
                  </dd>
                </div>
                <div>
                  <dt>{t('leads.summaryDeal')}</dt>
                  <dd>{lead.deal_id ? <Link href={`/app/crm/deals/${lead.deal_id}`}>{lead.deal_name}</Link> : t('leads.none')}</dd>
                </div>
                <div>
                  <dt>{t('leads.form.source')}</dt>
                  <dd>{(SOURCES as readonly string[]).includes(lead.source) ? t(`enums.source.${lead.source}`) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('leads.columns.lastActivity')}</dt>
                  <dd>{lead.last_activity_at ? formatDate(lead.last_activity_at, locale) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('leads.columns.created')}</dt>
                  <dd>{formatDate(lead.created_at, locale)}</dd>
                </div>
              </dl>
              <Link href={recordTabHref(base, 'properties')} className="record-summary-more">
                {t('companies.detail.viewAllProperties')}
              </Link>
            </aside>
          </div>
        </RecordTabs>
      </div>
    );
  }

  if (tab === 'properties') {
    const access = await fieldAccessFor(sessionFieldViewer(user), 'leads');
    const custom = parseCustom(redactCustomJson(lead.custom, access.hidden));
    const customFields = customPropFields(access.visible, custom, { yes: t('common.yes'), no: t('common.no'), locale, owners });
    const fields: PropField[] = [
      { key: 'name', label: t('leads.form.name'), type: 'text', value: lead.name },
      {
        key: 'stageId',
        label: t('leads.form.stage'),
        type: 'select',
        value: lead.stage_id,
        options: stages.map((s) => ({ value: s.id, label: s.name })),
      },
      {
        key: 'source',
        label: t('leads.form.source'),
        type: 'select',
        value: lead.source,
        options: [{ value: '', label: '—' }, ...SOURCES.map((s) => ({ value: s, label: t(`enums.source.${s}`) }))],
      },
      { key: 'disqualifyReason', label: t('leads.disqualify.reason'), type: 'text', value: lead.disqualify_reason },
      { key: 'ownerId', label: t('leads.form.owner'), type: 'select', value: lead.owner_id ?? user.id, options: owners },
      ...customFields,
    ];
    const sections: PropSection[] = [
      { title: t('leads.aboutSection'), keys: ['name', 'stageId', 'source', 'disqualifyReason'] },
      { title: t('leads.ownershipSection'), keys: ['ownerId'] },
      ...(customFields.length ? [{ title: t('leads.customSection'), keys: customFields.map((f) => f.key) }] : []),
    ];
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-props">
            <PropertiesPanel endpoint={`/api/crm/leads/${lead.id}`} fields={fields} custom={custom} sections={sections} />
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Relacionados: contacto y empresa del lead ----------
  const db = getDb();
  const [contacts, companies] = await Promise.all([
    db
      .prepare(`SELECT id, first_name, last_name, email FROM crm_contacts WHERE user_id = ?${scopeAnd('crm_contacts', scope).sql} ORDER BY created_at DESC LIMIT 200`)
      .all(user.id, ...scopeAnd('crm_contacts', scope).args) as Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>>,
    db
      .prepare(`SELECT id, name FROM crm_companies WHERE user_id = ?${scopeAnd('crm_companies', scope).sql} ORDER BY name COLLATE NOCASE LIMIT 300`)
      .all(user.id, ...scopeAnd('crm_companies', scope).args) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const contactName = (c: { first_name: string; last_name: string; email: string }) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
  return (
    <div className="ui-page record-page">
      {header}
      <RecordTabs>
        <div className="record-related">
          <section className="record-block">
            <AssociationPanel
              title={t('leads.summaryContact')}
              records={
                lead.contact_id
                  ? [{ id: lead.contact_id, name: lead.contact_name ?? lead.contact_email ?? '', href: `/app/crm/contacts/${lead.contact_id}`, meta: lead.contact_email ?? undefined }]
                  : []
              }
              options={lead.contact_id ? [] : contacts.map((c) => ({ id: c.id, value: contactName(c) }))}
              onAssociate={setLeadContact.bind(null, lead.id)}
              onRemove={clearLeadContact.bind(null, lead.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('leads.none')}
            />
          </section>
          <section className="record-block">
            <AssociationPanel
              title={t('leads.summaryCompany')}
              records={lead.company_id ? [{ id: lead.company_id, name: lead.company_name ?? '', href: `/app/crm/companies/${lead.company_id}` }] : []}
              options={lead.company_id ? [] : companies.map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={setLeadCompany.bind(null, lead.id)}
              onRemove={clearLeadCompany.bind(null, lead.id)}
              addLabel={t('objects.pickCompany')}
              emptyLabel={t('leads.none')}
            />
          </section>
          <section className="record-block">
            <div className="assoc-head">
              <h2 className="assoc-title">{t('leads.summaryDeal')}</h2>
            </div>
            {lead.deal_id ? (
              <p>
                <Link href={`/app/crm/deals/${lead.deal_id}`}>{lead.deal_name}</Link>
              </p>
            ) : (
              <p className="muted">{t('leads.none')}</p>
            )}
          </section>
        </div>
      </RecordTabs>
    </div>
  );
}
