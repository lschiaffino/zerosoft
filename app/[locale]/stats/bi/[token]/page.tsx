import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import ResultView from '@/components/bi/ResultView';
import { clientIp, hashedIp, rateLimit } from '@/lib/rate-limit';
import { dashboardById, shareByToken } from '@/lib/bi/store';
import { ownerViewer, runSharedQuestion } from '@/lib/bi/service';
import '@/styles/app-shared.css';
import '@/styles/analytics.css';
import '@/styles/bi.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'bi.public' });
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

const DATE_RANGES = ['last_7', 'last_30', 'last_90', 'last_365'];

/**
 * Pregunta o tablero compartido por link (token largo, se guarda solo su
 * hash, se puede apagar). Se calcula en el servidor con los permisos de
 * quien creó el link; al navegador llega el resultado, nunca la consulta.
 * Con ?embed=1 va sin marco (para un iframe).
 */
export default async function PublicBiShare(props: Props) {
  const { locale, token } = await props.params;
  const sp = await props.searchParams;
  const embed = sp.embed === '1';
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'bi.public' });
  const h = await headers();
  const limit = await rateLimit(`bishare:${hashedIp(clientIp(new Request('http://x', { headers: h })))}`, 60, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return <p className="bi-empty-result">{t('rateLimited')}</p>;

  const share = await shareByToken(token);
  if (!share) notFound();
  const viewer = await ownerViewer(share.workspaceId, share.createdBy);
  if (!viewer) notFound();

  if (share.kind === 'question') {
    const out = await runSharedQuestion(viewer, share.targetId, {}).catch(() => null);
    if (!out) notFound();
    return (
      <ClientMessages locale={locale} namespaces={['bi']}>
        <main className={`bi-public${embed ? ' is-embed' : ''}`} data-testid="bi-public">
          {!embed && <h1 className="bi-title">{out.question.name}</h1>}
          {'error' in out ? <p className="ui-error">{t('error')}</p> : <ResultView result={{ ...out.result, sql: '' }} viz={out.question.viz} title={out.question.name} />}
        </main>
      </ClientMessages>
    );
  }

  const dash = await dashboardById(share.workspaceId, share.targetId);
  if (!dash) notFound();
  const values: Record<string, string> = {};
  for (const f of dash.filters) {
    const v = sp[`f_${f.id}`];
    if (typeof v === 'string' && v.length <= 200) values[f.id] = v;
  }
  const cards = await Promise.all(
    dash.cards.slice(0, 30).map(async (c) => {
      if (c.kind === 'text' || !c.questionId) return { card: c, out: null };
      return { card: c, out: await runSharedQuestion(viewer, c.questionId, values, dash, c.id).catch(() => null) };
    }),
  );
  return (
    <ClientMessages locale={locale} namespaces={['bi']}>
      <main className={`bi-public${embed ? ' is-embed' : ''}`} data-testid="bi-public">
        {!embed && <h1 className="bi-title">{dash.name}</h1>}
        {dash.filters.length > 0 && (
          <form className="bi-filters" method="get">
            {embed && <input type="hidden" name="embed" value="1" />}
            {dash.filters.map((f) => (
              <label key={f.id} className="bi-inline-field">
                <span className="label">{f.name}</span>
                {f.type === 'date' ? (
                  <select className="input" name={`f_${f.id}`} defaultValue={values[f.id] ?? ''}>
                    <option value="">{t('anyTime')}</option>
                    {DATE_RANGES.map((r) => (
                      <option key={r} value={r}>
                        {t(`range.${r}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" name={`f_${f.id}`} defaultValue={values[f.id] ?? ''} maxLength={200} type={f.type === 'number' ? 'number' : 'text'} />
                )}
              </label>
            ))}
            <button type="submit" className="btn btn-sm">
              {t('apply')}
            </button>
          </form>
        )}
        {cards.length === 0 && <p className="bi-empty-result">{t('empty')}</p>}
        <div className="bi-grid">
          {cards.map(({ card, out }) => (
            <div key={card.id} className="bi-card" style={{ '--w': card.w, '--h': card.h } as CSSProperties}>
              {card.kind === 'text' ? (
                <div className="bi-text-card">{card.text}</div>
              ) : (
                <article className="bi-card-body">
                  <header className="bi-card-head">
                    <span className="bi-card-title">{out?.question.name ?? ''}</span>
                  </header>
                  <div className="bi-card-content">
                    {!out || 'error' in out ? <p className="ui-error">{t('error')}</p> : <ResultView result={{ ...out.result, sql: '' }} viz={out.question.viz} compact title={out.question.name} />}
                  </div>
                </article>
              )}
            </div>
          ))}
        </div>
      </main>
    </ClientMessages>
  );
}
