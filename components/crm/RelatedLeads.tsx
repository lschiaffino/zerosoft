import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ensureLeadStages, listLeads } from '@/lib/crm-leads';
import type { OwnerScope } from '@/lib/crm-visibility';
import { SOURCES } from '@/lib/crm-constants';
import LeadCreate from './LeadCreate';

/**
 * Leads de un contacto o una empresa (pestaña Relacionados), con el alta de
 * un lead nuevo ya asociado.
 */
export default async function RelatedLeads({
  workspaceId,
  contactId,
  companyId,
  contactName,
  companyName,
  scope,
  locale,
  owners,
  defaultOwner,
}: {
  workspaceId: string;
  contactId?: string;
  companyId?: string;
  contactName?: string;
  companyName?: string;
  scope: OwnerScope;
  locale: string;
  owners: Array<{ value: string; label: string }>;
  defaultOwner: string;
}) {
  const t = await getTranslations({ locale, namespace: 'crm' });
  const [stages, { rows }] = await Promise.all([
    ensureLeadStages(workspaceId, {}),
    listLeads(workspaceId, { contactId, companyId, ownerScope: scope, pageSize: 50 }),
  ]);
  return (
    <section className="record-block" data-testid="related-leads">
      <div className="assoc-head">
        <h2 className="assoc-title">
          {t('leads.contactLeads')} <span className="num muted">{rows.length}</span>
        </h2>
        <LeadCreate
          variant="secondary"
          label={t('leads.createForContact')}
          contacts={contactId ? [{ value: contactId, label: contactName ?? '' }] : []}
          companies={companyId ? [{ value: companyId, label: companyName ?? '' }] : []}
          owners={owners}
          stages={stages.filter((s) => s.kind === 'open').map((s) => ({ value: s.id, label: s.name }))}
          sources={SOURCES.map((s) => ({ value: s, label: t(`enums.source.${s}`) }))}
          defaultOwner={defaultOwner}
          fixedContactId={contactId}
          fixedCompanyId={companyId}
        />
      </div>
      {rows.length === 0 ? (
        <p className="muted">{t('leads.noLeads')}</p>
      ) : (
        <ul className="record-summary-list">
          {rows.map((l) => (
            <li key={l.id}>
              <Link href={`/app/crm/leads/${l.id}`}>{l.name}</Link>
              <span className="muted">
                {l.stage_name ?? '—'}
                {l.deal_name ? ` · ${l.deal_name}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
