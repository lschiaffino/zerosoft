import type { CSSProperties } from 'react';
import { setRequestLocale } from 'next-intl/server';
import BoardChrome from '@/components/board/BoardChrome';
import { BoardItemCard } from '@/components/board/BoardItemRow';
import { listBoardItems } from '@/lib/board';
import { boardLoginHref, getBoardContext } from '@/lib/board-context';
import { boardItemPath, boardPath } from '@/lib/board-paths';
import { getBoardPerson } from '@/lib/board-session';
import { boardLabels } from '@/lib/board-labels';
import { absoluteBoardUrl } from '@/lib/board-urls';
import { ROADMAP_PUBLIC_COLUMNS } from '@/lib/roadmap-constants';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const { t } = await boardLabels(locale);
  const title = t('meta.roadmapTitle');
  const description = t('meta.roadmapDescription');
  const url = absoluteBoardUrl(locale, '/roadmap');
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, type: 'website', url } };
}

/** Roadmap: lo comprometido (planeado, en curso, lanzado). */
export default async function BoardRoadmapPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const [ctx, person, labels] = await Promise.all([getBoardContext(locale), getBoardPerson(), boardLabels(locale)]);
  const { t } = labels;
  const items = await listBoardItems({ sort: 'top', userId: person?.id ?? null });
  const columns = ROADMAP_PUBLIC_COLUMNS.map((status) => {
    const list = items.filter((i) => i.status === status);
    if (status === 'done') list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { status, items: list };
  });
  const loginHref = boardLoginHref(ctx, '/roadmap');

  return (
    <>
      <BoardChrome ctx={ctx} person={person} active="roadmap" returnPath="/roadmap" />
      <main className="bp-wrap bp-page">
        <div className="bp-hero">
          <div>
            <h1 className="bp-title">{t('roadmap.title')}</h1>
            <p className="bp-intro">{t('roadmap.intro')}</p>
          </div>
          <a className="btn btn-ghost btn-small" href={boardPath(locale, ctx.onSurface, '/new')}>
            {t('hero.propose')}
          </a>
        </div>
        <div className="bp-columns" style={{ '--bp-cols': 3 } as CSSProperties}>
          {columns.map((col) => (
            <section key={col.status} aria-labelledby={`bp-rm-${col.status}`}>
              <header className="bp-col-head">
                <h2 id={`bp-rm-${col.status}`}>{labels.status[col.status]}</h2>
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
                      href={boardItemPath(locale, ctx.onSurface, item.id, item.title)}
                      signedIn={Boolean(person)}
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
      </main>
    </>
  );
}
