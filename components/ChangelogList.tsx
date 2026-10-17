import { getTranslations } from 'next-intl/server';
import { pick } from '@/content/changelog';
import type { UnifiedChangelogEntry } from '@/lib/changelog';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/product-taxonomy';
import BrandSymbol from '@/components/brand/BrandSymbol';
import ProductMark from '@/components/site/ProductMark';
import EmptyState from '@/components/ui/EmptyState';

function dateParts(iso: string, locale: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d),
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d),
  };
}

/**
 * Lista del changelog (repo + base), con filtro por producto. La usan
 * /changelog y el changelog del board. Se dibuja como una línea con una
 * estación por versión; cada cambio lleva el tramo de la línea de su app.
 * Las entradas de la base traen el cuerpo en HTML ya sanitizado
 * (lib/changelog.ts) y los ítems que cerraron.
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
      <div className="cl-toolbar">
        <nav className="ui-tabs cl-filters" aria-label={t('label')}>
          <a href={filterHref(null)} className="ui-tab" aria-current={filter ? undefined : 'page'}>
            {t('filterAll')}
          </a>
          {products.map((p) => (
            <a
              key={p}
              href={filterHref(p)}
              className={`ui-tab card-${p}`}
              aria-current={filter === p ? 'page' : undefined}
            >
              <ProductMark product={p} size={10} />
              {tp(p)}
            </a>
          ))}
        </nav>
        <span className="cl-count">{t('releases', { count: visible.length })}</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t('empty')} action={{ label: t('filterAll'), href: filterHref(null) }} quiet />
      ) : (
        <ol className="cl-list">
          {visible.map((e) => {
            const d = dateParts(e.date, locale);
            return (
              <li key={e.id} id={e.id} className="cl-entry">
                <div className="cl-date">
                  <time dateTime={e.date} title={d.full}>
                    <span className="cl-day">{d.day}</span>
                    <span className="cl-month">{d.month}</span>
                  </time>
                </div>
                <BrandSymbol size={22} className="cl-node" />
                <article className="cl-card">
                  <h2 className="cl-title">
                    <a href={`#${e.id}`}>{pick(e.title, locale)}</a>
                  </h2>
                  {e.body && pick(e.body, locale) && (
                    <div className="cl-body" dangerouslySetInnerHTML={{ __html: pick(e.body, locale) }} />
                  )}
                  {e.items.length > 0 && (
                    <ul className="cl-items">
                      {e.items.map((item, i) => (
                        <li key={i}>
                          <span className="cl-tag">
                            <ProductMark product={item.product} size={10} />
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
      )}
    </>
  );
}
