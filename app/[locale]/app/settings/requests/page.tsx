import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { listMyRequests } from '@/lib/my-requests';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'requests');
}

/**
 * Ajustes › Mis pedidos: lo que la persona pidió (al asistente o como idea),
 * con su estado. Solo los propios: cada fila abre la página del pedido.
 */
export default async function MyRequestsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const person = user.actingUser ?? user;
  const t = await getTranslations({ locale, namespace: 'settings.requests' });
  const rows = await listMyRequests({ id: person.id, email: person.email }, locale);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <div className="st-stack">
      <p className="muted st-req-desc">{t('desc')}</p>
      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul className="st-req-list" aria-label={t('listLabel')} data-testid="my-requests">
          {rows.map((r) => (
            <li key={r.id} className="st-req-row" data-stage={r.stage} data-testid="my-request-row" data-id={r.id}>
              <Link href={r.path} className="st-req-title" prefetch={false}>
                {r.title}
              </Link>
              <span className="st-req-meta">
                <span className="st-req-stage" data-stage={r.stage}>
                  {t(`status.${r.stage}`)}
                </span>
                <span>{t('asked', { date: fmt(r.askedAt) })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
