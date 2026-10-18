import { setRequestLocale } from 'next-intl/server';
import BoardChrome from '@/components/board/BoardChrome';
import BoardFilters from '@/components/board/BoardFilters';
import { BoardItemCard, BoardItemRow } from '@/components/board/BoardItemRow';
import BoardPendingGroup from '@/components/board/BoardPendingGroup';
import { listBoardItems, listMyPendingItems, parseBoardSort, type BoardItem } from '@/lib/board';
import { boardLoginHref, getBoardContext } from '@/lib/board-context';
import { boardItemPath, boardPath } from '@/lib/board-paths';
import { getBoardPerson } from '@/lib/board-session';
import { boardLabels } from '@/lib/board-labels';
import { absoluteBoardUrl } from '@/lib/board-urls';
import { BOARD_COLUMNS } from '@/lib/roadmap-constants';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const { t } = await boardLabels(locale);
  const title = t('meta.title');
  const description = t('meta.description');
  const url = absoluteBoardUrl(locale);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'website', url },
  };
}

/** Board público: lista (top / nuevos / tendencia) o columnas por estado. */
export default async function FeedbackBoardPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; product?: string; status?: string; sort?: string; view?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const [ctx, person, labels] = await Promise.all([getBoardContext(locale), getBoardPerson(), boardLabels(locale)]);
  const { t } = labels;
  const view = sp.view === 'columns' ? 'columns' : 'list';
  const [items, pending] = await Promise.all([
    listBoardItems({
      q: sp.q,
      product: sp.product,
      status: view === 'list' ? sp.status : null,
      sort: view === 'list' ? parseBoardSort(sp.sort) : 'top',
      userId: person?.id ?? null,
    }),
    // Lo que la persona mandó desde la burbuja y sigue en triage privado.
    sp.q || (view === 'list' && sp.status) ? Promise.resolve([]) : listMyPendingItems(person, { product: sp.product }),
  ]);
  const qs = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''),
  ).toString();
  const loginHref = boardLoginHref(ctx, qs ? `?${qs}` : '');
  const signedIn = Boolean(person);
  const href = (item: BoardItem) => boardItemPath(locale, ctx.onSurface, item.id, item.title);

  const columns = BOARD_COLUMNS.map((status) => ({ status, items: items.filter((i) => i.status === status) }));

  return (
    <>
      <BoardChrome ctx={ctx} person={person} active="board" returnPath={qs ? `?${qs}` : ''} />
      <main className="bp-wrap bp-page">
        <div className="bp-hero">
          <div>
            <h1 className="bp-title">{t('hero.title')}</h1>
            <p className="bp-intro">{t('hero.intro')}</p>
          </div>
          <a className="btn btn-primary" href={boardPath(locale, ctx.onSurface, '/new')}>
            {t('hero.propose')}
          </a>
        </div>

        <BoardFilters
          view={view}
          basePath={boardPath(locale, ctx.onSurface)}
          labels={{
            search: t('toolbar.search'),
            allProducts: t('toolbar.allProducts'),
            allStatuses: t('toolbar.allStatuses'),
            sortLabel: t('toolbar.sortLabel'),
            productLabel: t('toolbar.productLabel'),
            statusLabel: t('toolbar.statusLabel'),
            list: t('toolbar.list'),
            columns: t('toolbar.columns'),
            count: t('toolbar.count', { count: items.length }),
            sort: labels.sort,
            status: labels.status,
            product: labels.product,
          }}
        />

        <BoardPendingGroup
          items={pending}
          labels={{ title: t('pending.title'), status: t('pending.status'), hint: t('pending.hint'), product: labels.product }}
        />

        {view === 'list' ? (
          items.length === 0 ? (
            <p className="bp-empty">{sp.q ? t('emptySearch') : t('empty')}</p>
          ) : (
            <ul className="bp-list">
              {items.map((item) => (
                <BoardItemRow
                  key={item.id}
                  item={item}
                  href={href(item)}
                  signedIn={signedIn}
                  loginHref={loginHref}
                  locale={locale}
                  labels={labels.row}
                />
              ))}
            </ul>
          )
        ) : (
          <div className="bp-columns">
            {columns.map((col) => (
              <section key={col.status} aria-labelledby={`bp-col-${col.status}`}>
                <header className="bp-col-head">
                  <h2 id={`bp-col-${col.status}`}>{labels.status[col.status]}</h2>
                  <span className="bp-col-count">{col.items.length}</span>
                </header>
                {col.items.length === 0 ? (
                  <p className="bp-empty">{t('columnEmpty')}</p>
                ) : (
                  <ul className="bp-list">
                    {col.items.map((item) => (
                      <BoardItemCard
                        key={item.id}
                        item={item}
                        href={href(item)}
                        signedIn={signedIn}
                        loginHref={loginHref}
                        locale={locale}
                        labels={labels.row}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
