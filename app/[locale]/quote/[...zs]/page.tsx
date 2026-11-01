import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ensureBooks } from '@/lib/books';
import { getCurrentUser } from '@/lib/session';
import { markQuoteViewed, quoteByToken } from '@/lib/books-quotes';
import { bpsToPercent, formatMoney } from '@/lib/books-money';
import PublicQuoteActions from '@/components/books/PublicQuoteActions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs: string[] }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs } = await props.params;
  const t = await getTranslations({ locale, namespace: 'books.public' });
  const found = zs.length === 1 ? await quoteByToken(zs[0]) : null;
  return { title: found ? found.quote.label : t('quoteNotFound'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Presupuesto enviado a un cliente: se lee y se acepta o rechaza sin login. */
export default async function PublicQuotePage(props: Props) {
  const { locale, zs } = await props.params;
  setRequestLocale(locale);
  if (zs.length !== 1) notFound();
  const found = await quoteByToken(zs[0]);
  if (!found) notFound();
  const { ws, quote } = found;
  const viewer = await getCurrentUser().catch(() => null);
  if (!viewer || viewer.id !== ws) await markQuoteViewed(quote.id).catch(() => undefined);
  const s = await ensureBooks(ws);
  const t = await getTranslations({ locale, namespace: 'books.public' });
  const money = (v: number) => formatMoney(v, quote.currency, locale);
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  const fmtDate = (d: string) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const company = s.trade_name || s.legal_name;
  const accent = /^#[0-9a-fA-F]{6}$/.test(s.brand_color) ? s.brand_color : '#1e3a8a';
  return (
    <main className="bk-public" style={{ ['--bk-brand' as string]: accent }}>
      <article className="bk-public-doc" aria-labelledby="bk-public-title">
        <header className="bk-public-head">
          <div>
            {s.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bk-public-logo" src={s.logo_url} alt={company} />
            ) : (
              <p className="bk-public-company">{company}</p>
            )}
            <p className="bk-public-muted">
              {[s.legal_name, s.tax_id, s.address, s.email].filter(Boolean).map((x) => (
                <span key={x}>
                  {x}
                  <br />
                </span>
              ))}
            </p>
          </div>
          <div className="bk-public-title-box">
            <h1 id="bk-public-title" className="bk-public-title">
              {t('quote')}
            </h1>
            <p className="bk-public-number">{quote.label}</p>
            {quote.title && <p className="bk-public-muted">{quote.title}</p>}
          </div>
        </header>
        <section className="bk-public-parties">
          <div>
            <h2 className="bk-public-label">{t('billTo')}</h2>
            <p>{quote.contactName}</p>
          </div>
          <dl className="bk-public-dates">
            <div>
              <dt>{t('issued')}</dt>
              <dd>{fmtDate(quote.issueDate)}</dd>
            </div>
            {quote.expiryDate && (
              <div>
                <dt>{t('validUntil')}</dt>
                <dd>{fmtDate(quote.expiryDate)}</dd>
              </div>
            )}
          </dl>
        </section>
        <div className="bk-public-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('description')}</th>
                <th scope="col" className="num">
                  {t('qty')}
                </th>
                <th scope="col" className="num">
                  {t('price')}
                </th>
                <th scope="col" className="num">
                  {t('amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.description}
                    {l.taxBps ? <span className="bk-public-muted"> · {t('taxAt', { rate: bpsToPercent(l.taxBps) })}</span> : null}
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td className="num">{money(quote.taxInclusive ? l.total : l.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="bk-public-totals">
          <div>
            <dt>{t('subtotal')}</dt>
            <dd>{money(quote.subtotal - quote.discountTotal)}</dd>
          </div>
          {quote.taxBreakdown
            .filter((r) => r.taxBps > 0)
            .map((r) => (
              <div key={r.taxBps}>
                <dt>{quote.taxInclusive ? t('taxIncludedAt', { rate: bpsToPercent(r.taxBps) }) : t('taxAt', { rate: bpsToPercent(r.taxBps) })}</dt>
                <dd>{money(r.tax)}</dd>
              </div>
            ))}
          <div className="bk-public-total">
            <dt>{t('total')}</dt>
            <dd>{money(quote.total)}</dd>
          </div>
        </dl>
        {quote.terms && <p className="bk-public-notes">{quote.terms}</p>}
        {s.footer && <p className="bk-public-muted bk-public-footer">{s.footer}</p>}
      </article>
      <PublicQuoteActions token={zs[0]} status={quote.status} decidedName={quote.decidedName} />
    </main>
  );
}
