import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { requestViewForSession, REQUESTS_PATH } from '@/lib/my-requests';

export const dynamic = 'force-dynamic';

async function load(locale: string, id: string) {
  return requestViewForSession(await requireUser(locale), decodeURIComponent(id), locale);
}

export async function generateMetadata(props: { params: Promise<{ locale: string; id: string }> }): Promise<Metadata> {
  const { locale, id } = await props.params;
  const view = await load(locale, id);
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${view?.title ?? t('sections.requests')} · ${t('title')}`, robots: { index: false } };
}

/**
 * Página de un pedido: la ven quienes lo pidieron y los admins; el resto
 * recibe el mismo 404 que un id que no existe. Muestra el título, el estado
 * en lenguaje común, cuándo cambió, las palabras de quien mira (nunca las de
 * otra persona) y, si salió, el link al changelog.
 */
export default async function RequestPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ unsubscribed?: string }>;
}) {
  const { locale, id } = await props.params;
  const { unsubscribed } = await props.searchParams;
  const view = await load(locale, id);
  if (!view) notFound();
  const t = await getTranslations({ locale, namespace: 'settings.requests' });
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <article className="st-stack st-req" data-testid="request-page" data-stage={view.stage}>
      <Link href={REQUESTS_PATH} className="st-imp-back" prefetch={false}>
        ← {t('back')}
      </Link>
      <h2 className="st-req-heading">{view.title}</h2>
      {unsubscribed === '1' && (
        <p className="st-callout" role="status">
          {t('unsubscribed')}
        </p>
      )}

      <section className="st-block" aria-labelledby="req-status">
        <h3 id="req-status" className="st-block-title">
          {t('statusTitle')}
        </h3>
        <p className="st-req-status">
          <span className="st-req-stage" data-stage={view.stage} data-testid="request-stage">
            {t(`status.${view.stage}`)}
          </span>
          {view.statusChangedAt && <span className="muted">{t('since', { date: fmt(view.statusChangedAt) })}</span>}
        </p>
        <p>{t(`statusHelp.${view.stage}`)}</p>
        {view.declinedReason && <p>{t('reason', { reason: view.declinedReason })}</p>}
        {view.changelogUrl && (
          <p>
            <a href={view.changelogUrl} data-testid="request-changelog">
              {t('changelog')}
            </a>
          </p>
        )}
        {view.publicUrl && (
          <p>
            <a href={view.publicUrl} data-testid="request-public">
              {t('publicPage')}
            </a>
          </p>
        )}
        {view.isRequester && view.stage !== 'shipped' && view.stage !== 'declined' && <p className="muted">{t('emailNote')}</p>}
      </section>

      {view.words.length > 0 && (
        <section className="st-block" aria-labelledby="req-words">
          <h3 id="req-words" className="st-block-title">
            {t('yourWords')}
          </h3>
          <ul className="st-req-words" data-testid="request-words">
            {view.words.map((w) => (
              <li key={w.at}>
                <p className="st-req-text">{w.text}</p>
                <span className="muted">{t('asked', { date: fmt(w.at) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.adminPath && (
        <p className="muted" data-testid="request-admin">
          {!view.isRequester && `${t('adminNote')} `}
          <Link href={view.adminPath} prefetch={false}>
            {t('adminLink')}
          </Link>
        </p>
      )}
      {!view.publicUrl && <p className="muted st-req-private">{t('privateNote')}</p>}
    </article>
  );
}
