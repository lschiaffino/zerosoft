'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import LocalText from '@/components/ui/LocalText';
import type { PulseItem, PulseTab } from '@/lib/track-pulse';
import { MarkdownView } from '../MarkdownView';
import { HealthDot, LoadingRows, fmtWhen, initialsOf } from './shared';
import { updateAuthor } from './PlanUpdates';

const TABS: PulseTab[] = ['for_me', 'all'];

function previousProgress(meta: string): number | null {
  try {
    const m = JSON.parse(meta) as { previousProgress?: unknown };
    return typeof m.previousProgress === 'number' ? m.previousProgress : null;
  } catch {
    return null;
  }
}

/**
 * Updates (Pulse de Linear): los updates de projects e initiatives del
 * workspace en un solo feed, "Para mí" o "Todos", con "Cargar más".
 */
export default function UpdatesFeed() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const sp = useSearchParams();
  const [tab, setTab] = useState<PulseTab>(() => (sp.get('tab') === 'all' ? 'all' : 'for_me'));
  const [items, setItems] = useState<PulseItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const seq = useRef(0);

  const load = useCallback(
    async (before: string | null) => {
      const mine = ++seq.current;
      const q = new URLSearchParams({ tab });
      if (before) q.set('before', before);
      const res = await fetch(`/api/track/updates?${q}`).catch(() => null);
      if (mine !== seq.current) return;
      if (!res?.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { items: PulseItem[]; nextBefore: string | null };
      if (mine !== seq.current) return;
      setError(false);
      setItems((cur) => (before ? [...(cur ?? []), ...data.items] : data.items));
      setNext(data.nextBefore);
    },
    [tab],
  );

  useEffect(() => {
    setItems(null);
    setNext(null);
    void load(null);
  }, [load]);

  // La pestaña va en la URL (se comparte y sobrevive a recargar) sin navegar.
  const select = (k: PulseTab) => {
    setTab(k);
    const url = new URL(window.location.href);
    if (k === 'for_me') url.searchParams.delete('tab');
    else url.searchParams.set('tab', k);
    window.history.replaceState(window.history.state, '', url);
  };

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const k = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    select(k);
    tabRefs.current[k]?.focus();
  };

  const more = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    await load(next);
    setLoadingMore(false);
  };

  return (
    <div className="tp-pulse" data-testid="tp-pulse">
      <div className="ui-tabs" role="tablist" aria-label={t('pulse.title')}>
        {TABS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            className="ui-tab"
            id={`tp-pulse-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="tp-pulse-panel"
            tabIndex={tab === k ? 0 : -1}
            onClick={() => select(k)}
            onKeyDown={(e) => onTabKey(e, i)}
            data-testid={`tp-pulse-tab-${k}`}
          >
            {t(`pulse.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tp-pulse-panel" aria-labelledby={`tp-pulse-tab-${tab}`}>
        {error && items === null ? (
          <EmptyState
            quiet
            title={t('pulse.error')}
            action={
              <button type="button" className="btn btn-sm" onClick={() => void load(null)}>
                {t('common.retry')}
              </button>
            }
          />
        ) : items === null ? (
          <LoadingRows rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            quiet
            title={t(tab === 'for_me' ? 'pulse.emptyMine' : 'pulse.emptyAll')}
            body={t(tab === 'for_me' ? 'pulse.emptyMineBody' : 'pulse.emptyAllBody')}
            action={
              tab === 'for_me' ? (
                <button type="button" className="btn btn-sm" onClick={() => select('all')}>
                  {t('pulse.seeAll')}
                </button>
              ) : (
                <Link className="btn btn-sm" href="/app/track/projects">
                  {t('pulse.goProjects')}
                </Link>
              )
            }
          />
        ) : (
          <>
            <ol className="tp-feed tp-pulse-feed" data-testid="tp-pulse-feed">
              {items.map((u) => {
                const name = updateAuthor(u);
                const href = u.kind === 'project' ? `/app/track/projects/${u.parent_id}?tab=updates` : `/app/track/initiatives/${u.parent_id}`;
                const prev = u.kind === 'project' ? previousProgress(u.meta) : null;
                return (
                  <li key={`${u.kind}-${u.id}`} className="tp-card tp-update tp-pulse-item" data-testid="tp-pulse-item" data-kind={u.kind}>
                    <div className="tp-pulse-parent">
                      <span className="ui-help">{t(`pulse.kind.${u.kind}`)}</span>
                      <Link href={href} className="tp-pulse-parent-link" data-testid="tp-pulse-parent">
                        {u.parent_name}
                      </Link>
                    </div>
                    <div className="tp-update-head">
                      <HealthDot health={u.health} label={t(`health.${u.health}`)} />
                      <span className="tp-update-author">
                        <span className="track-avatar" aria-hidden>
                          {initialsOf(name)}
                        </span>
                        {name}
                      </span>
                      <time className="ui-help" dateTime={u.created_at}>
                        <LocalText>{fmtWhen(u.created_at, locale)}</LocalText>
                        {u.updated_at ? ` · ${t('updates.edited')}` : ''}
                      </time>
                    </div>
                    {u.body && <MarkdownView source={u.body} className="tp-update-body tp-pulse-body" />}
                    {(u.progress !== null || u.comment_count > 0) && (
                      <p className="ui-help tp-pulse-foot">
                        {u.progress !== null &&
                          (prev !== null && Math.abs(prev - u.progress) > 2
                            ? t('updates.progressChange', { from: prev, to: u.progress })
                            : t('updates.progressNow', { value: u.progress }))}
                        {u.progress !== null && u.comment_count > 0 && ' · '}
                        {u.comment_count > 0 && (
                          <Link href={href} className="tp-pulse-comments">
                            {t('pulse.comments', { count: u.comment_count })}
                          </Link>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {next && (
              <div className="tp-pulse-more">
                <button type="button" className="btn btn-sm" onClick={() => void more()} aria-busy={loadingMore || undefined} data-testid="tp-pulse-more">
                  {t('pulse.more')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
