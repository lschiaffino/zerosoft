import type { CSSProperties } from 'react';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import BoardChrome from '@/components/board/BoardChrome';
import BoardVote from '@/components/board/BoardVote';
import BoardComments from '@/components/board/BoardComments';
import BoardSubscribe from '@/components/board/BoardSubscribe';
import { getPublicItem, hasVoted, isSubscribed, listComments, listStatusEvents } from '@/lib/board';
import { boardLoginHref, getBoardContext } from '@/lib/board-context';
import { boardItemPath, boardPath } from '@/lib/board-paths';
import { getBoardPerson } from '@/lib/board-session';
import { boardLabels } from '@/lib/board-labels';
import { absoluteItemUrl } from '@/lib/board-urls';
import { productColor } from '@/lib/product-taxonomy';
import { ROADMAP_VOTABLE_STATUSES, idFromRef, itemRef } from '@/lib/roadmap-constants';

export const dynamic = 'force-dynamic';

function excerpt(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export async function generateMetadata(props: { params: Promise<{ locale: string; ref: string }> }) {
  const { locale, ref } = await props.params;
  const item = await getPublicItem(idFromRef(ref));
  if (!item) return {};
  const { t } = await boardLabels(locale);
  const title = item.title;
  const description = item.description ? excerpt(item.description) : t('meta.description');
  const url = absoluteItemUrl(locale, item.id, item.title);
  const image = `/api/og/board/${encodeURIComponent(item.id)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'article', url, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

/** Detalle de un ítem: descripción, voto, timeline de estados, changelog y comentarios. */
export default async function BoardItemPage(props: {
  params: Promise<{ locale: string; ref: string }>;
  searchParams: Promise<{ unsubscribed?: string }>;
}) {
  const { locale, ref } = await props.params;
  const { unsubscribed } = await props.searchParams;
  setRequestLocale(locale);
  const item = await getPublicItem(idFromRef(ref));
  if (!item) notFound();
  const [ctx, person, labels] = await Promise.all([getBoardContext(locale), getBoardPerson(), boardLabels(locale)]);
  const canonicalRef = itemRef(item.id, item.title);
  if (decodeURIComponent(ref) !== canonicalRef) redirect(boardItemPath(locale, ctx.onSurface, item.id, item.title));

  const { t } = labels;
  const [voted, subscribed, comments, events] = await Promise.all([
    hasVoted(item.id, person?.id ?? null),
    isSubscribed(item.id, person?.id ?? null),
    listComments(item.id),
    listStatusEvents(item.id),
  ]);
  const returnPath = `/i/${canonicalRef}`;
  const loginHref = boardLoginHref(ctx, returnPath);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  // El timeline arranca con la creación; los eventos de 'idea' inicial no se repiten.
  const timeline = events.filter((e, i) => !(i === 0 && e.from_status === null));

  return (
    <>
      <BoardChrome ctx={ctx} person={person} active="board" returnPath={returnPath} />
      <main className="bp-wrap">
        <div className="bp-detail">
          <article>
            <a className="bp-back" href={boardPath(locale, ctx.onSurface)}>
              ← {t('detail.back')}
            </a>
            {unsubscribed === '1' && <p className="bp-hint">{t('detail.unsubscribedNotice')}</p>}
            <div className="bp-detail-head">
              <BoardVote
                id={item.id}
                votes={item.votes}
                voted={voted}
                closed={!ROADMAP_VOTABLE_STATUSES.includes(item.status)}
                signedIn={Boolean(person)}
                loginHref={loginHref}
                locale={locale}
                labels={labels.vote}
              />
              <div>
                <h1 className="bp-detail-title">{item.title}</h1>
                <p className="bp-meta">
                  <span className="bp-status" data-status={item.status}>
                    {labels.status[item.status]}
                  </span>
                  <span className="bp-dot" style={{ '--dot': productColor(item.product) } as CSSProperties}>
                    {labels.product[item.product] ?? item.product}
                  </span>
                  <span>{t(`kind.${item.kind}`)}</span>
                </p>
              </div>
            </div>
            {item.description && <p className="bp-detail-desc">{item.description}</p>}
            {item.status === 'declined' && (
              <div className="bp-closed">
                <strong>{t('detail.closedTitle')}</strong>
                <p>{item.declined_reason || t('detail.closedNoReason')}</p>
              </div>
            )}
            {item.status === 'done' && (
              <div className="bp-shipped">
                {t('detail.shipped')}{' '}
                {item.shipped_changelog_id && (
                  <a href={`${boardPath(locale, ctx.onSurface, '/changelog')}#${item.shipped_changelog_id}`}>
                    {t('detail.shippedLink')}
                  </a>
                )}
              </div>
            )}
            <BoardComments
              itemId={item.id}
              initial={comments}
              personId={person?.id ?? null}
              isAdmin={Boolean(person?.isAdmin)}
              loginHref={loginHref}
              locale={locale}
              labels={{
                title: t('comment.title'),
                empty: t('comment.empty'),
                placeholder: t('comment.placeholder'),
                send: t('comment.send'),
                sending: t('comment.sending'),
                officialTag: t('comment.officialTag'),
                pinned: t('comment.pinned'),
                pin: t('comment.pin'),
                unpin: t('comment.unpin'),
                markOfficial: t('comment.markOfficial'),
                unmarkOfficial: t('comment.unmarkOfficial'),
                postOfficial: t('comment.postOfficial'),
                delete: t('comment.delete'),
                deleteConfirm: t('comment.deleteConfirm'),
                loginToComment: t('comment.loginToComment'),
                error: t('comment.error'),
                anonymous: t('comment.anonymous'),
                markdownHint: t('comment.markdownHint'),
              }}
            />
          </article>

          <aside className="bp-side">
            <div className="bp-side-block">
              <h3>{t('detail.follow')}</h3>
              <BoardSubscribe
                itemId={item.id}
                initial={subscribed}
                signedIn={Boolean(person)}
                loginHref={loginHref}
                locale={locale}
                labels={{
                  subscribe: t('detail.subscribe'),
                  unsubscribe: t('detail.unsubscribe'),
                  hint: t('detail.subscribeHint'),
                }}
              />
            </div>
            <div className="bp-side-block">
              <h3>{t('detail.timeline')}</h3>
              <ol className="bp-timeline">
                <li>
                  <time dateTime={item.created_at}>{fmt(item.created_at)}</time>
                  {t('detail.created')}
                </li>
                {timeline.map((e) => (
                  <li key={e.id}>
                    <time dateTime={e.created_at}>{fmt(e.created_at)}</time>
                    {t('detail.movedTo', { status: labels.status[e.to_status] ?? t('detail.inReview') })}
                    {e.note && <p>{e.note}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
