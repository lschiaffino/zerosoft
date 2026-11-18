import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ensureBooks } from '@/lib/books';
import { contactByPortalToken, contactStatement } from '@/lib/books-statements';
import { addMonths, formatMoney, todayIso } from '@/lib/books-money';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs: string[] }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'books.public' });
  return { title: t('statement'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Portal del cliente: su estado de cuenta y sus facturas abiertas, con un link que se puede revocar. */
export default async function PublicStatementPage(props: Props) {
  const { locale, zs } = await props.params;
  setRequestLocale(locale);
  if (zs.length !== 1) notFound();
  const found = await contactByPortalToken(zs[0]);
  if (!found) notFound();
  const s = await ensureBooks(found.ws);
  const t = await getTranslations({ locale, namespace: 'books.public' });
  const today = todayIso();
  const st = await contactStatement(found.ws, found.contact.id, addMonths(today, -12), today, 'customer');
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
            <p className="bk-public-muted">{[s.legal_name, s.tax_id, s.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="bk-public-title-box">
            <h1 id="bk-public-title" className="bk-public-title">
              {t('statement')}
            </h1>
            <p className="bk-public-number">{found.contact.name}</p>
            <p className="bk-public-muted">{t('statementRange', { from: fmtDate(st.from), to: fmtDate(st.to) })}</p>
          </div>
        </header>
        {st.currencies.length === 0 && <p className="bk-public-muted">{t('statementEmpty')}</p>}
        {st.currencies.map((c) => {
          const money = (v: number) => formatMoney(v, c.currency, locale);
          return (
            <section key={c.currency} className="bk-public-statement">
              {c.outstanding.length > 0 && (
                <>
                  <h2 className="bk-public-label">{t('statementOpen')}</h2>
                  <div className="bk-public-table">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{t('invoice')}</th>
                          <th scope="col">{t('due')}</th>
                          <th scope="col" className="num">
                            {t('balance')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.outstanding.map((d) => (
                          <tr key={d.id}>
                            <td>{d.publicToken ? <Link href={`/invoice/${d.publicToken}`}>{d.label}</Link> : d.label}</td>
                            <td data-overdue={d.overdue || undefined}>{d.dueDate ? fmtDate(d.dueDate) : '-'}</td>
                            <td className="num">{money(d.due)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <h2 className="bk-public-label">{t('statementActivity')}</h2>
              <div className="bk-public-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('issued')}</th>
                      <th scope="col">{t('description')}</th>
                      <th scope="col" className="num">
                        {t('statementCharge')}
                      </th>
                      <th scope="col" className="num">
                        {t('statementCredit')}
                      </th>
                      <th scope="col" className="num">
                        {t('balance')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4}>{t('statementOpening')}</td>
                      <td className="num">{money(c.opening)}</td>
                    </tr>
                    {c.entries.map((e, i) => (
                      <tr key={`${e.docId}:${i}`}>
                        <td>{fmtDate(e.date)}</td>
                        <td>
                          {t(`statementKinds.${e.kind}`)} {e.label}
                        </td>
                        <td className="num">{e.charge ? money(e.charge) : ''}</td>
                        <td className="num">{e.credit ? money(e.credit) : ''}</td>
                        <td className="num">{money(e.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="bk-public-totals">
                <div className="bk-public-total">
                  <dt>{t('statementClosing', { currency: c.currency })}</dt>
                  <dd>{money(c.closing)}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </article>
    </main>
  );
}
