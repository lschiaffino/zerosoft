import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { isComingSoon, PRODUCT_CONFIG } from '@/lib/products';
import { waitlistCounts } from '@/lib/waitlist';
import AdminNav from '@/components/app/AdminNav';
import EmptyState from '@/components/ui/EmptyState';
import ProductGlyph from '@/components/brand/ProductGlyph';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('admin.waitlist.nav')} · ${t('title')}`, robots: { index: false } };
}

/**
 * Admin › Lista de espera: cuántas personas esperan cada app "Próximamente"
 * (total, últimos 7 días, cuántas dijeron para qué) y el CSV, de todas o de
 * una. Solo ADMIN_EMAILS; para el resto, 404.
 */
export default async function WaitlistAdminPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const me = user.actingUser ?? user;
  if (!isAdminEmail(me.email)) notFound();
  const t = await getTranslations({ locale, namespace: 'settings.admin.waitlist' });
  const counts = await waitlistCounts();
  const total = counts.reduce((n, c) => n + c.total, 0);

  return (
    <div className="st-stack">
      <AdminNav
        locale={locale}
        current="waitlist"
        description={t('desc')}
        aside={
          total > 0 ? (
            <a href="/api/waitlist/export" className="btn btn-secondary btn-sm" download data-testid="waitlist-export-all">
              {t('exportAll')}
            </a>
          ) : undefined
        }
      />
      {total === 0 && <EmptyState quiet compact title={t('emptyTitle')} body={t('emptyBody')} />}
      <div className="table-wrap">
        <table className="table table-compact st-waitlist-table" data-testid="waitlist-counts">
          <thead>
            <tr>
              <th scope="col">{t('app')}</th>
              <th scope="col" className="num">
                {t('total')}
              </th>
              <th scope="col" className="num">
                {t('last7')}
              </th>
              <th scope="col" className="num">
                {t('withUseCase')}
              </th>
              <th scope="col">{t('state')}</th>
              <th scope="col">
                <span className="sr-only">{t('export')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.app} data-testid={`waitlist-row-${c.app}`}>
                <td>
                  <span className="st-waitlist-app">
                    <ProductGlyph product={c.app} size={14} /> {PRODUCT_CONFIG[c.app].name}
                  </span>
                </td>
                <td className="num data">{c.total}</td>
                <td className="num data">{c.last7}</td>
                <td className="num data">{c.withUseCase}</td>
                <td>{isComingSoon(c.app) ? t('soon') : t('live', { notified: c.notified, total: c.total })}</td>
                <td>
                  {c.total > 0 && (
                    <a href={`/api/waitlist/export?app=${c.app}`} download className="st-waitlist-csv">
                      {t('csv')}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
