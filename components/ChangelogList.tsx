import type { CSSProperties } from 'react';
import { getTranslations } from 'next-intl/server';
import { pick } from '@/content/changelog';
import type { UnifiedChangelogEntry } from '@/lib/changelog';
import { PRODUCT_KEYS, productColor, type ProductKey } from '@/lib/product-taxonomy';

function dateParts(iso: string, locale: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat(locale, { day: '2-digit', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(d).replace('.', ''),
    year: String(d.getUTCFullYear()),
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d),
  };
}

/**
 * Lista del changelog (repo + base), con filtro por producto. La usan
 * /changelog y el changelog del board. Las entradas de la base traen el
 * cuerpo en HTML ya sanitizado (lib/changelog.ts) y los ítems que cerraron.
 */
export default async function ChangelogList({
  locale,
  entries,
  filter,
  filterHref,
  itemHref,
}: {
  locale: string;
  entries: UnifiedChangelogEntry[];
  filter: ProductKey | null;
  /** Link del filtro (null = todos). */
  filterHref: (product: ProductKey | null) => string;
  itemHref: (id: string, title: string) => string;
}) {
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const tp = await getTranslations({ locale, namespace: 'feedbackBoard.product' });
  const used = new Set(entries.flatMap((e) => e.products));
  const products = PRODUCT_KEYS.filter((p) => used.has(p));
  const visible = entries
    .map((e) => ({ ...e, items: filter ? e.items.filter((i) => i.product === filter) : e.items }))
    .filter((e) => !filter || e.products.includes(filter));

  return (
    <>
      <nav className="cl-filters" aria-label={t('label')}>
        <a href={filterHref(null)} className={`cl-chip${filter ? '' : ' active'}`}>
          {t('filterAll')}
        </a>
        {products.map((p) => (
          <a
            key={p}
            href={filterHref(p)}
            className={`cl-chip${filter === p ? ' active' : ''}`}
            style={{ '--dot': productColor(p) } as CSSProperties}
          >
            <i aria-hidden="true" />
            {tp(p)}
          </a>
        ))}
        <span className="cl-count mono">{t('releases', { count: visible.length })}</span>
      </nav>

      <ol className="cl-list">
        {visible.map((e) => {
          const d = dateParts(e.date, locale);
          return (
            <li key={e.id} id={e.id} className="cl-entry">
              <div className="cl-date">
                <time dateTime={e.date} title={d.full}>
                  <span className="cl-day">{d.day}</span>
                  <span className="cl-month">
                    {d.month} {d.year}
                  </span>
                </time>
              </div>
              <span className="cl-node" aria-hidden="true" />
              <article className="cl-card">
                <div className="cl-card-top">
                  <span className="cl-dots" aria-hidden="true">
                    {e.products.map((p) => (
                      <i key={p} style={{ background: productColor(p) }} />
                    ))}
                  </span>
                  <a className="cl-anchor mono" href={`#${e.id}`}>
                    #{e.id}
                  </a>
                </div>
                <h2 className="cl-title">{pick(e.title, locale)}</h2>
                {e.body && pick(e.body, locale) && (
                  <div className="cl-body" dangerouslySetInnerHTML={{ __html: pick(e.body, locale) }} />
                )}
                {e.items.length > 0 && (
                  <ul className="cl-items">
                    {e.items.map((item, i) => (
                      <li key={i} style={{ '--dot': productColor(item.product) } as CSSProperties}>
                        <span className="cl-tag">
                          <i aria-hidden="true" />
                          {tp(item.product)}
                        </span>
                        <span className="cl-text">{pick(item, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.closed.length > 0 && (
                  <div className="cl-closed">
                    <p>{t('closedItems', { count: e.closed.length })}</p>
                    <ul>
                      {e.closed.map((c) => (
                        <li key={c.id}>
                          <a href={itemHref(c.id, c.title)}>{c.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </>
  );
}
