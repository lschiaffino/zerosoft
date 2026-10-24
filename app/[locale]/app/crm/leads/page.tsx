import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import { scopeAnd, sessionScope } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { ensureLeadStages, listLeads, listLeadsForBoard } from '@/lib/crm-leads';
import { SOURCES } from '@/lib/crm-constants';
import { ownerOptions } from '@/lib/crm-owners';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import CrmPager from '@/components/crm/CrmPager';
import ListToolbar from '@/components/crm/ListToolbar';
import LeadCreate from '@/components/crm/LeadCreate';
import LeadsBoard, { type BoardColumn } from '@/components/crm/LeadsBoard';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATUSES = ['open', 'qualified', 'disqualified'] as const;
const SORTS = ['newest', 'oldest', 'name', 'last_activity'] as const;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Leads: tabla o board por etapa, con búsqueda, etapa, owner y estado. */
export default async function LeadsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = await sessionScope(user);
  // La primera vez se siembran las etapas de HubSpot en el idioma de quien entra.
  const stages = await ensureLeadStages(user.id, {
    new: t('leads.defaultStages.new'),
    attempting: t('leads.defaultStages.attempting'),
    connected: t('leads.defaultStages.connected'),
    qualified: t('leads.defaultStages.qualified'),
    disqualified: t('leads.defaultStages.disqualified'),
  });

  const view = one(sp.view) === 'board' ? 'board' : 'table';
  const q = one(sp.q) ?? '';
  const stageId = stages.some((s) => s.id === one(sp.stage)) ? (one(sp.stage) as string) : '';
  const owner = one(sp.owner) ?? '';
  const statusParam = one(sp.status) ?? '';
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as (typeof STATUSES)[number]) : undefined;
  const sortParam = one(sp.sort) ?? '';
  const sort = (SORTS as readonly string[]).includes(sortParam) ? (sortParam as (typeof SORTS)[number]) : 'newest';
  const page = Number(one(sp.page) ?? '1') || 1;

  const db = getDb();
  const [owners, contactRows, companyRows] = await Promise.all([
    ownerOptions(user),
    db
      .prepare(`SELECT id, first_name, last_name, email FROM crm_contacts WHERE user_id = ?${scopeAnd('crm_contacts', scope).sql} ORDER BY created_at DESC LIMIT 300`)
      .all(user.id, ...scopeAnd('crm_contacts', scope).args) as Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>>,
    db
      .prepare(`SELECT id, name FROM crm_companies WHERE user_id = ?${scopeAnd('crm_companies', scope).sql} ORDER BY name COLLATE NOCASE LIMIT 300`)
      .all(user.id, ...scopeAnd('crm_companies', scope).args) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const ownerName = new Map(owners.map((o) => [o.value, o.label]));
  const query: Record<string, string> = Object.fromEntries(
    Object.entries({ view: view === 'board' ? 'board' : '', q, stage: stageId, owner, status: status ?? '', sort: sort === 'newest' ? '' : sort }).filter(
      ([, v]) => v,
    ),
  );
  const hasFilters = !!(q || stageId || owner || status);
  const contactName = (c: { first_name: string; last_name: string; email: string }) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

  const create = (variant: 'primary' | 'empty') => (
    <LeadCreate
      variant={variant}
      contacts={contactRows.map((c) => ({ value: c.id, label: contactName(c) }))}
      companies={companyRows.map((c) => ({ value: c.id, label: c.name }))}
      owners={owners}
      stages={stages.filter((s) => s.kind === 'open').map((s) => ({ value: s.id, label: s.name }))}
      sources={SOURCES.map((s) => ({ value: s, label: t(`enums.source.${s}`) }))}
      defaultOwner={realUserId(user)}
    />
  );

  const viewHref = (v: 'table' | 'board') => {
    const params = new URLSearchParams({ ...query, view: v === 'board' ? 'board' : '' });
    if (v === 'table') params.delete('view');
    for (const [k, val] of [...params.entries()]) if (!val) params.delete(k);
    const qs = params.toString();
    return qs ? `/app/crm/leads?${qs}` : '/app/crm/leads';
  };

  let body: React.ReactNode;
  if (view === 'board') {
    const board = await listLeadsForBoard(user.id, { q: q || undefined, owner: owner || undefined, ownerScope: scope });
    const columns: BoardColumn[] = board.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      count: s.count,
      leads: s.leads.map((l) => ({
        id: l.id,
        name: l.name,
        // El nombre del lead suele ser el del contacto: no se repite en la card.
        contact: (l.contact_name ?? l.contact_email ?? '') === l.name ? '' : (l.contact_name ?? l.contact_email ?? ''),
        company: l.company_name ?? '',
        owner: ownerName.get(l.owner_id ?? user.id) ?? '',
        converted: !!l.deal_id,
      })),
    }));
    const empty = board.every((s) => s.count === 0);
    body = empty && !hasFilters ? (
      <EmptyState title={t('leads.emptyTitle')} body={t('leads.emptyBody')} action={create('empty')} />
    ) : (
      <LeadsBoard columns={columns} />
    );
  } else {
    const { rows, total } = await listLeads(user.id, {
      q: q || undefined,
      stageId: stageId || undefined,
      owner: owner || undefined,
      status,
      ownerScope: scope,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    body =
      rows.length === 0 ? (
        hasFilters ? (
          <EmptyState title={t('leads.noMatchTitle')} body={t('leads.noMatchBody')} action={{ label: t('leads.clearFilters'), href: '/app/crm/leads' }} />
        ) : (
          <EmptyState title={t('leads.emptyTitle')} body={t('leads.emptyBody')} action={create('empty')} />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="table crm-table" data-testid="leads-table">
              <caption className="sr-only">{t('leads.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('leads.columns.name')}</th>
                  <th scope="col">{t('leads.columns.stage')}</th>
                  <th scope="col" className="hide-sm">
                    {t('leads.columns.contact')}
                  </th>
                  <th scope="col" className="hide-sm">
                    {t('leads.columns.company')}
                  </th>
                  <th scope="col" className="hide-sm">
                    {t('leads.columns.owner')}
                  </th>
                  <th scope="col" className="num cell-date hide-sm">
                    {t('leads.columns.lastActivity')}
                  </th>
                  <th scope="col" className="num cell-date">
                    {t('leads.columns.created')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/app/crm/leads/${l.id}`} className="cell-name">
                        {l.name}
                      </Link>
                      {l.deal_name && <span className="muted cell-sub">{t('leads.columns.deal')}: {l.deal_name}</span>}
                    </td>
                    <td>
                      <span className={`badge lead-kind-${l.stage_kind ?? 'open'}`}>{l.stage_name ?? '—'}</span>
                    </td>
                    <td className="muted hide-sm">
                      {l.contact_id ? <Link href={`/app/crm/contacts/${l.contact_id}`}>{l.contact_name ?? l.contact_email}</Link> : '—'}
                    </td>
                    <td className="muted hide-sm">
                      {l.company_id ? <Link href={`/app/crm/companies/${l.company_id}`}>{l.company_name}</Link> : '—'}
                    </td>
                    <td className="muted hide-sm">{ownerName.get(l.owner_id ?? user.id) ?? l.owner_name ?? '—'}</td>
                    <td className="num muted cell-date hide-sm">{l.last_activity_at ? formatDate(l.last_activity_at, locale) : '—'}</td>
                    <td className="num muted cell-date">{formatDate(l.created_at, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CrmPager pathname="/app/crm/leads" query={query} page={Math.min(page, pages)} pages={pages} total={total} locale={locale} />
        </>
      );
  }

  return (
    <div className="app-page ui-page crm-leads-page">
      <PageHeader title={t('leads.title')} description={t('leads.subtitle')} actions={create('primary')} />
      <div className="leads-bar">
        <nav className="btn-group" aria-label={t('leads.viewLabel')}>
          <Link href={viewHref('table')} className="btn btn-secondary btn-sm" aria-current={view === 'table' ? 'page' : undefined}>
            {t('leads.viewTable')}
          </Link>
          <Link href={viewHref('board')} className="btn btn-secondary btn-sm" aria-current={view === 'board' ? 'page' : undefined}>
            {t('leads.viewBoard')}
          </Link>
        </nav>
        <ListToolbar
          searchLabel={t('leads.search')}
          q={q}
          query={query}
          selects={[
            ...(view === 'table'
              ? [
                  {
                    param: 'status',
                    label: t('leads.status.all'),
                    value: status ?? '',
                    options: [
                      { value: '', label: t('leads.status.all') },
                      ...STATUSES.map((s) => ({ value: s, label: t(`leads.status.${s}`) })),
                    ],
                  },
                  {
                    param: 'stage',
                    label: t('leads.columns.stage'),
                    value: stageId,
                    options: [{ value: '', label: t('leads.allStages') }, ...stages.map((s) => ({ value: s.id, label: s.name }))],
                  },
                ]
              : []),
            {
              param: 'owner',
              label: t('leads.columns.owner'),
              value: owner,
              options: [{ value: '', label: t('leads.allOwners') }, ...owners],
            },
          ]}
        />
      </div>
      {body}
    </div>
  );
}
