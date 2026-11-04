import type { Metadata } from 'next';
import DashboardText from '@/components/analytics/DashboardText';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import InsightResultView from '@/components/analytics/InsightResultView';
import ShareChrome, { ShareUnlock } from '@/components/analytics/ShareChrome';
import { shareAccessOk, shareByToken, shareCookieName, shareHasPasswordProtect } from '@/lib/analytics/records-more';
import { publicShareView } from '@/lib/analytics/share-view';
import { clientIp, hashedIp, rateLimit } from '@/lib/rate-limit';
import { cookies, headers } from 'next/headers';
import '@/styles/app-shared.css';
import '@/styles/analytics.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ embed?: string; refresh?: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics.share' });
  return { title: t('publicTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * Insight o tablero compartido (token largo y revocable). Solo lee: corre la
 * consulta guardada del lado del servidor y al navegador llega el resultado,
 * nunca la consulta, y sin ids de personas. Con ?embed=1 va sin marco.
 */
export default async function PublicAnalyticsShare(props: Props) {
  const { locale, token } = await props.params;
  const { embed, refresh } = await props.searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'analytics.share' });
  const h = await headers();
  const ip = clientIp(new Request('http://x', { headers: h }));
  const limit = await rateLimit(`ashare:${hashedIp(ip)}`, 60, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') {
    return <p className="an-empty-result">{t('rateLimited')}</p>;
  }
  // Con contraseña: nada se calcula ni se manda hasta que este navegador la haya dado.
  const share = await shareByToken(token);
  if (share && (await shareHasPasswordProtect(share.id))) {
    const access = (await cookies()).get(shareCookieName(share.id))?.value;
    if (!(await shareAccessOk(share.id, access))) {
      return (
        <ClientMessages locale={locale} namespaces={['analytics']}>
          <main className={`an-share-public${embed ? ' is-embed' : ''}`} data-testid="an-share-locked">
            <ShareUnlock token={token} />
          </main>
        </ClientMessages>
      );
    }
  }
  const view = await publicShareView(token, refresh === 'true');
  if (!view) notFound();
  return (
    <ClientMessages locale={locale} namespaces={['analytics']}>
      <main className={`an-share-public${embed ? ' is-embed' : ''}`} data-testid="an-share-public">
        <ShareChrome theme={view.options.theme ?? 'system'} embed={Boolean(embed)} />
        {!embed && (
          <header className="an-share-head">
            <h1 className="an-share-title">{view.title}</h1>
            {view.description && <p className="an-note">{view.description}</p>}
          </header>
        )}
        {view.tiles.length === 0 && <p className="an-empty-result">{t('emptyPublic')}</p>}
        <div className={view.tiles.length > 1 ? 'an-tiles' : 'an-form'}>
          {view.tiles.map((tile, i) => (
            <article key={i} className={`an-tile an-panel is-${tile.size ?? 'm'}`}>
              {tile.text !== undefined && <DashboardText body={tile.text} />}
              {tile.text === undefined && (view.tiles.length > 1 || embed) && <h2 className="an-h3 an-flush">{tile.name}</h2>}
              {tile.error ? <p className="ui-error">{t('tileError')}</p> : tile.result && <InsightResultView result={tile.result} display={tile.display} />}
            </article>
          ))}
        </div>
      </main>
    </ClientMessages>
  );
}
