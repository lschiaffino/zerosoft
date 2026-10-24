import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { canSeeOwner, scopeAnd, sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { getObjectBySlug, getRecord, objectEntity, recordLinks } from '@/lib/crm-objects';
import { listTimeline, parseCustom } from '@/lib/crm';
import { fieldAccessFor, redactCustomJson, sessionFieldViewer } from '@/lib/crm-field-perms';
import { ownerOptions } from '@/lib/crm-owners';
import { formatDate } from '@/lib/utils';
import { withActivityFiles } from '@/lib/crm-files';
import PageHeader from '@/components/ui/PageHeader';
import RecordTabs from '@/components/crm/RecordTabs';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import DangerDelete from '@/components/crm/DangerDelete';
import Timeline from '@/components/crm/Timeline';
import NextTaskBanner from '@/components/crm/NextTaskBanner';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import AssociationPanel from '@/components/crm/AssociationPanel';
import { customPropFields } from '@/components/crm/customPropFields';
import { parseRecordTab, recordTabHref } from '@/components/crm/recordTab';
import { linkObjectRecord, unlinkObjectRecord } from '@/components/crm/objectActions';

export const dynamic = 'force-dynamic';

/** Ficha de un registro de objeto propio: actividad, propiedades y asociaciones. */
export default async function ObjectRecordPage(props: {
  params: Promise<{ locale: string; slug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, slug, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const tab = parseRecordTab(sp.tab);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const object = await getObjectBySlug(user.id, slug);
  if (!object) notFound();
  const scope = await sessionScope(user);
  const record = await getRecord(user.id, id);
  if (!record || record.object_id !== object.id || !canSeeOwner(scope, record.owner_id, user.id)) notFound();

  const base = `/app/crm/objects/${object.slug}/${record.id}`;
  const primaryLabel = object.primary_label || t('objects.defaultPrimary');
  const [owners, access] = await Promise.all([ownerOptions(user), fieldAccessFor(sessionFieldViewer(user), objectEntity(object.id))]);
  const ownerLabel = owners.find((o) => o.value === (record.owner_id ?? user.id))?.label ?? '—';
  const custom = parseCustom(redactCustomJson(record.custom, access.hidden));
  const customFields = customPropFields(access.visible, custom, { yes: t('common.yes'), no: t('common.no'), locale, owners });

  const header = (
    <PageHeader
      back={{ href: `/app/crm/objects/${object.slug}`, label: object.plural }}
      title={record.name}
      description={
        <span className="record-meta">
          <span className="badge">{object.singular}</span>
          <span>{ownerLabel}</span>
          <span>{formatDate(record.created_at, locale)}</span>
        </span>
      }
      actions={
        <RecordMoreMenu
          items={[
            {
              key: 'delete',
              label: t('objects.recordDeleteButton'),
              title: t('objects.recordDeleteTitle'),
              tone: 'danger',
              content: (
                <DangerDelete
                  bare
                  endpoint={`/api/crm/records/${record.id}`}
                  confirmToken={record.name}
                  redirectTo={`/app/crm/objects/${object.slug}`}
                  title={t('objects.recordDeleteTitle')}
                  desc={t('objects.recordDeleteDesc')}
                  buttonLabel={t('objects.recordDeleteButton')}
                  confirmLabel={t('record.confirmType', { token: record.name })}
                  errorLabel={t('errors.generic')}
                />
              ),
            },
          ]}
        />
      }
    />
  );

  if (tab === 'activity') {
    const [timeline, links] = await Promise.all([
      listTimeline(user.id, { objectRecordId: record.id, limit: 100 }),
      recordLinks(user.id, record.id),
    ]);
    const items = await withActivityFiles(timeline);
    // Próxima tarea abierta del registro (la de vencimiento más cercano).
    const open = timeline
      .filter((a) => a.type === 'task' && !a.done)
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))[0];
    const summary = customFields.slice(0, 6);
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-activity">
            <div className="record-activity-main">
              <NextTaskBanner task={open ? { id: open.id, subject: open.subject, due_at: open.due_at } : null} locale={locale} />
              <Timeline
                recordType="objectRecord"
                recordId={record.id}
                items={items}
                emptyLabel={t('objects.emptyTimeline')}
                mentionables={owners.map((o) => ({ id: o.value, name: o.label, email: '' }))}
                locale={locale}
              />
            </div>
            <aside className="record-summary" aria-label={t('record.summary')}>
              <dl className="record-facts">
                <div>
                  <dt>{t('objects.owner')}</dt>
                  <dd>{ownerLabel}</dd>
                </div>
                {summary.map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{f.display || (f.type === 'select' ? f.options?.find((o) => o.value === f.value)?.label : f.value) || '—'}</dd>
                  </div>
                ))}
              </dl>
              <Link href={recordTabHref(base, 'properties')} className="record-summary-more">
                {t('companies.detail.viewAllProperties')}
              </Link>
              {(
                [
                  ['assocContacts', links.contacts.map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email, href: `/app/crm/contacts/${c.id}` }))],
                  ['assocCompanies', links.companies.map((c) => ({ id: c.id, name: c.name, href: `/app/crm/companies/${c.id}` }))],
                  ['assocDeals', links.deals.map((d) => ({ id: d.id, name: d.name, href: `/app/crm/deals/${d.id}` }))],
                ] as const
              ).map(([key, list]) => (
                <div className="record-summary-block" key={key}>
                  <h2 className="record-summary-title">
                    {t(`objects.${key}`)} <span className="num">{list.length}</span>
                  </h2>
                  {list.length > 0 && (
                    <ul className="record-summary-list">
                      {list.slice(0, 5).map((x) => (
                        <li key={x.id}>
                          <Link href={x.href}>{x.name}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <Link href={recordTabHref(base, 'related')} className="record-summary-more">
                {t('record.manageRelated')}
              </Link>
            </aside>
          </div>
        </RecordTabs>
      </div>
    );
  }

  if (tab === 'properties') {
    const fields: PropField[] = [
      { key: 'name', label: primaryLabel, type: 'text', value: record.name },
      { key: 'ownerId', label: t('objects.owner'), type: 'select', value: record.owner_id ?? user.id, options: owners },
      ...customFields,
    ];
    const sections: PropSection[] = [
      { title: t('objects.aboutSection'), keys: ['name'] },
      { title: t('objects.ownershipSection'), keys: ['ownerId'] },
      ...(customFields.length ? [{ title: t('objects.customSection'), keys: customFields.map((f) => f.key) }] : []),
    ];
    return (
      <div className="ui-page record-page">
        {header}
        <RecordTabs>
          <div className="record-props">
            <PropertiesPanel endpoint={`/api/crm/records/${record.id}`} fields={fields} custom={custom} sections={sections} />
            {customFields.length === 0 && <p className="ui-help">{t('objects.noProperties')}</p>}
          </div>
        </RecordTabs>
      </div>
    );
  }

  // ---------- Relacionados ----------
  const db = getDb();
  const [links, contactRows, companyRows, dealRows] = await Promise.all([
    recordLinks(user.id, record.id),
    db
      .prepare(`SELECT id, first_name, last_name, email FROM crm_contacts WHERE user_id = ?${scopeAnd('crm_contacts', scope).sql} ORDER BY created_at DESC LIMIT 200`)
      .all(user.id, ...scopeAnd('crm_contacts', scope).args) as Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>>,
    db
      .prepare(`SELECT id, name FROM crm_companies WHERE user_id = ?${scopeAnd('crm_companies', scope).sql} ORDER BY name COLLATE NOCASE LIMIT 300`)
      .all(user.id, ...scopeAnd('crm_companies', scope).args) as Promise<Array<{ id: string; name: string }>>,
    db
      .prepare(`SELECT id, name FROM crm_deals WHERE user_id = ?${scopeAnd('crm_deals', scope).sql} ORDER BY created_at DESC LIMIT 200`)
      .all(user.id, ...scopeAnd('crm_deals', scope).args) as Promise<Array<{ id: string; name: string }>>,
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
              title={t('objects.assocContacts')}
              count={links.contacts.length}
              records={links.contacts.map((c) => ({ id: c.id, name: contactName(c), href: `/app/crm/contacts/${c.id}`, meta: c.email || undefined }))}
              options={contactRows.filter((c) => !links.contacts.some((l) => l.id === c.id)).map((c) => ({ id: c.id, value: contactName(c) }))}
              onAssociate={linkObjectRecord.bind(null, record.id, 'contact')}
              onRemove={unlinkObjectRecord.bind(null, record.id, 'contact')}
              addLabel={t('objects.pickContact')}
              emptyLabel={t('objects.noContacts')}
            />
          </section>
          <section className="record-block">
            <AssociationPanel
              title={t('objects.assocCompanies')}
              count={links.companies.length}
              records={links.companies.map((c) => ({ id: c.id, name: c.name, href: `/app/crm/companies/${c.id}`, meta: c.domain || undefined }))}
              options={companyRows.filter((c) => !links.companies.some((l) => l.id === c.id)).map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={linkObjectRecord.bind(null, record.id, 'company')}
              onRemove={unlinkObjectRecord.bind(null, record.id, 'company')}
              addLabel={t('objects.pickCompany')}
              emptyLabel={t('objects.noCompanies')}
            />
          </section>
          <section className="record-block">
            <AssociationPanel
              title={t('objects.assocDeals')}
              count={links.deals.length}
              records={links.deals.map((d) => ({ id: d.id, name: d.name, href: `/app/crm/deals/${d.id}` }))}
              options={dealRows.filter((d) => !links.deals.some((l) => l.id === d.id)).map((d) => ({ id: d.id, value: d.name }))}
              onAssociate={linkObjectRecord.bind(null, record.id, 'deal')}
              onRemove={unlinkObjectRecord.bind(null, record.id, 'deal')}
              addLabel={t('objects.pickDeal')}
              emptyLabel={t('objects.noDeals')}
            />
          </section>
        </div>
      </RecordTabs>
    </div>
  );
}
