import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  listCompanies,
  listContacts,
  listSavedViews,
  parseCustom,
  type ContactFilter,
} from '@/lib/crm';
import { formatDate } from '@/lib/utils';
import ContactsFilters, { type ContactSort } from '@/components/crm/ContactsFilters';
import ContactsTable, { type ContactRow } from '@/components/crm/ContactsTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const SORTS: readonly ContactSort[] = ['newest', 'oldest', 'name', 'name_desc', 'email', 'email_desc'];

interface ContactsPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export default async function ContactsPage({ params: { locale }, searchParams }: ContactsPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  // Vista guardada activa: sus filtros sirven de default; los params explícitos ganan.
  const views = await listSavedViews(user.id, 'contacts');
  const activeView = views.find((v) => v.id === one(searchParams.view)) ?? null;
  const viewQuery = activeView ? parseCustom(activeView.query) : {};

  const q = one(searchParams.q) ?? str(viewQuery.q) ?? '';
  const lifecycle = one(searchParams.lifecycle) ?? str(viewQuery.lifecycle) ?? '';
  const leadStatus = one(searchParams.leadStatus) ?? str(viewQuery.leadStatus) ?? '';
  const source = one(searchParams.source) ?? str(viewQuery.source) ?? '';
  const sortParam = one(searchParams.sort) ?? str(viewQuery.sort) ?? 'newest';
  const sort: ContactSort = SORTS.includes(sortParam as ContactSort)
    ? (sortParam as ContactSort)
    : 'newest';
  const page = Number(one(searchParams.page) ?? '1') || 1;

  const { rows, total } = await listContacts(user.id, {
    q: q || undefined,
    lifecycle: lifecycle || undefined,
    leadStatus: leadStatus || undefined,
    source: source || undefined,
    sort: sort as ContactFilter['sort'],
    page,
  });
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const companies = (await listCompanies(user.id, { pageSize: 200, sort: 'name' })).rows.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const tableRows: ContactRow[] = rows.map((c) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`.trim() || c.email || '—',
    email: c.email,
    phone: c.phone,
    companyName: c.company_name,
    companyId: c.company_id,
    lifecycle: c.lifecycle_stage,
    leadStatus: c.lead_status,
    source: c.source,
    created: formatDate(c.created_at, locale),
  }));

  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (lifecycle) query.lifecycle = lifecycle;
  if (leadStatus) query.leadStatus = leadStatus;
  if (source) query.source = source;
  if (sort !== 'newest') query.sort = sort;
  if (activeView) query.view = activeView.id;

  const hasFilters = !!q || !!lifecycle || !!leadStatus || !!source;

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('contacts.title')}</h1>
        <Link href="/app/crm/contacts/new" className="btn btn-solid btn-small">
          {t('contacts.newCta')}
        </Link>
      </div>

      <ContactsFilters
        q={q}
        lifecycle={lifecycle}
        leadStatus={leadStatus}
        source={source}
        sort={sort}
        lifecycles={[...LIFECYCLE_STAGES]}
        leadStatuses={[...LEAD_STATUSES]}
        sources={[...SOURCES]}
        views={views.map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeView?.id ?? null}
      />

      {tableRows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('contacts.emptyTitle')}</h2>
          <p className="muted">{t('contacts.emptySub')}</p>
          {!hasFilters && (
            <Link href="/app/crm/contacts/new" className="btn btn-solid btn-small">
              {t('contacts.emptyCta')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <ContactsTable
            rows={tableRows}
            lifecycles={[...LIFECYCLE_STAGES]}
            leadStatuses={[...LEAD_STATUSES]}
            sources={[...SOURCES]}
            sort={sort}
            companies={companies}
          />
          {pages > 1 && (
            <nav className="pager mono">
              {page > 1 ? (
                <Link
                  href={{
                    pathname: '/app/crm/contacts',
                    query: { ...query, page: String(page - 1) },
                  }}
                  className="pager-btn"
                >
                  {t('common.pagePrev')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('common.pagePrev')}</span>
              )}
              <span className="pager-info">{t('common.pageOf', { page, pages })}</span>
              {page < pages ? (
                <Link
                  href={{
                    pathname: '/app/crm/contacts',
                    query: { ...query, page: String(page + 1) },
                  }}
                  className="pager-btn"
                >
                  {t('common.pageNext')}
                </Link>
              ) : (
                <span className="pager-btn disabled">{t('common.pageNext')}</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
