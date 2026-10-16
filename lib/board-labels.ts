import { getTranslations } from 'next-intl/server';
import { PRODUCT_KEYS } from './product-taxonomy';
import { BOARD_SORTS, ROADMAP_PUBLIC_STATUSES } from './roadmap-constants';
import type { BoardRowLabels } from '@/components/board/BoardItemRow';

/** Textos del board ya resueltos para pasar a componentes cliente. */
export async function boardLabels(locale: string) {
  const t = await getTranslations({ locale, namespace: 'feedbackBoard' });
  const status = Object.fromEntries(ROADMAP_PUBLIC_STATUSES.map((s) => [s, t(`status.${s}`)])) as Record<string, string>;
  const product = Object.fromEntries(PRODUCT_KEYS.map((p) => [p, t(`product.${p}`)])) as Record<string, string>;
  const sort = Object.fromEntries(BOARD_SORTS.map((s) => [s, t(`toolbar.sort.${s}`)])) as Record<string, string>;
  const vote = {
    upvote: t('vote.upvote'),
    voted: t('vote.voted'),
    error: t('vote.error'),
    loginToVote: t('vote.loginToVote'),
  };
  const row: BoardRowLabels = {
    vote,
    status,
    product,
    comments: (count: number) => t('comments', { count }),
  };
  return { t, status, product, sort, vote, row };
}
