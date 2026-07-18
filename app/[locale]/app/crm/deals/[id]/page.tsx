import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, listCustomFields, listTimeline, parseCustom, PRIORITIES, SOURCES } from '@/lib/crm';
import DangerDelete from '@/components/crm/DangerDelete';
import DealContacts from '@/components/crm/DealContacts';
import DealStagePanel from '@/components/crm/DealStagePanel';
import { customPropFields } from '@/components/crm/customPropFields';
import PropertiesPanel, { type PropField } from '@/components/crm/PropertiesPanel';
import Timeline from '@/components/crm/Timeline';

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

  const timeline = await listTimeline(user.id, { dealId: id, limit: 100 });

  const stages = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
    .all(deal.pipeline_id)) as CrmStageRow[];

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
    ...customPropFields(await listCustomFields(user.id, 'deals'), custom, {
      yes: t('common.yes'),
      no: t('common.no'),
    }),
  ];

  const contactChips = contacts.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    email: c.email,
  }));

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
      </header>

      <div className="detail-grid">
        <section className="panel">
          <h2 className="section-label">{t('deals.detail.properties')}</h2>
          <PropertiesPanel endpoint={`/api/crm/deals/${deal.id}`} fields={fields} custom={custom} />
        </section>

        <div className="app-page" style={{ gap: 20 }}>
          <section className="panel">
            <h2 className="section-label">{t('deals.table.stage')}</h2>
            <DealStagePanel
              dealId={deal.id}
              stages={stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost }))}
              currentStageId={deal.stage_id}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="section-label">{t('deals.detail.contacts')}</h2>
              <span className="panel-more">{contacts.length}</span>
            </div>
            <DealContacts dealId={deal.id} contacts={contactChips} />
          </section>

          <section className="panel">
            <h2 className="section-label">{t('deals.detail.timeline')}</h2>
            <Timeline
              recordType="deal"
              recordId={deal.id}
              items={timeline}
              emptyLabel={t('deals.detail.emptyTimeline')}
              locale={locale}
            />
          </section>
        </div>
      </div>

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
  );
}
