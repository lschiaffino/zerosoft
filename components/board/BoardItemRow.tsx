import type { CSSProperties } from 'react';
import BoardVote, { type BoardVoteLabels } from './BoardVote';
import type { BoardItem } from '@/lib/board';
import { productColor } from '@/lib/product-taxonomy';
import { ROADMAP_VOTABLE_STATUSES } from '@/lib/roadmap-constants';

export interface BoardRowLabels {
  vote: BoardVoteLabels;
  status: Record<string, string>;
  product: Record<string, string>;
  comments: (count: number) => string;
}

/** Fila de la lista del board: voto, título, extracto y metadatos. */
export function BoardItemRow({
  item,
  href,
  signedIn,
  loginHref,
  locale,
  labels,
}: {
  item: BoardItem;
  href: string;
  signedIn: boolean;
  loginHref: string;
  locale: string;
  labels: BoardRowLabels;
}) {
  return (
    <li className="bp-row">
      <BoardVote
        id={item.id}
        votes={item.votes}
        voted={item.voted}
        closed={!ROADMAP_VOTABLE_STATUSES.includes(item.status)}
        signedIn={signedIn}
        loginHref={loginHref}
        locale={locale}
        labels={labels.vote}
      />
      <div>
        <h3 className="bp-row-title">
          <a href={href}>{item.title}</a>
        </h3>
        {item.description && <p className="bp-row-desc">{item.description}</p>}
        <p className="bp-meta">
          <span className="bp-status" data-status={item.status}>
            {labels.status[item.status] ?? item.status}
          </span>
          <span className="bp-dot" style={{ '--dot': productColor(item.product) } as CSSProperties}>
            {labels.product[item.product] ?? item.product}
          </span>
          {item.comment_count > 0 && <span>{labels.comments(item.comment_count)}</span>}
        </p>
      </div>
    </li>
  );
}

/** Tarjeta compacta para la vista por columnas. */
export function BoardItemCard({
  item,
  href,
  signedIn,
  loginHref,
  locale,
  labels,
}: {
  item: BoardItem;
  href: string;
  signedIn: boolean;
  loginHref: string;
  locale: string;
  labels: BoardRowLabels;
}) {
  return (
    <li className="bp-card">
      <div>
        <p className="bp-card-title">
          <a href={href}>{item.title}</a>
        </p>
        <p className="bp-meta">
          <span className="bp-dot" style={{ '--dot': productColor(item.product) } as CSSProperties}>
            {labels.product[item.product] ?? item.product}
          </span>
          {item.comment_count > 0 && <span>{labels.comments(item.comment_count)}</span>}
        </p>
      </div>
      <BoardVote
        id={item.id}
        votes={item.votes}
        voted={item.voted}
        closed={!ROADMAP_VOTABLE_STATUSES.includes(item.status)}
        signedIn={signedIn}
        loginHref={loginHref}
        locale={locale}
        labels={labels.vote}
      />
    </li>
  );
}
