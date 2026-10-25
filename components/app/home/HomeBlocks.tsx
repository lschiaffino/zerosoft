import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ProductGlyph from '@/components/brand/ProductGlyph';
import type { ProductKey } from '@/lib/products';
import { homeCalBookings, homeCrmTasks, homeRecents, homeTrackIssues, homeUnread, type HomeUser } from '@/lib/home';
import { parseDbUtc, relDate } from '@/lib/utils';

/**
 * Bloques del inicio (/app). Cada uno es un componente async con su propio
 * Suspense en la página: el fallback es HomeBlockLoading y, si la lectura
 * falla, el bloque muestra su error sin tirar la página.
 */

interface BlockFrameProps {
  product: ProductKey;
  title: string;
  href: string;
  viewAll: string;
  testId: string;
  children: ReactNode;
  busy?: boolean;
}

function BlockFrame({ product, title, href, viewAll, testId, children, busy }: BlockFrameProps) {
  return (
    <section className={`home-block card-${product}`} data-testid={testId} aria-busy={busy || undefined} aria-label={title}>
      <header className="home-block-head">
        <ProductGlyph product={product} size={14} />
        <h3 className="home-block-title">{title}</h3>
        <Link href={href} className="home-block-more" aria-label={`${viewAll}: ${title}`}>
          {viewAll}
        </Link>
      </header>
      {children}
    </section>
  );
}

export async function HomeBlockLoading({
  locale,
  product,
  titleKey,
  href,
  testId,
}: {
  locale: string;
  product: ProductKey;
  titleKey: string;
  href: string;
  testId: string;
}) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  return (
    <BlockFrame product={product} title={t(titleKey)} href={href} viewAll={t('viewAll')} testId={testId} busy>
      <div className="home-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="sr-only">{t('loading')}</p>
    </BlockFrame>
  );
}

function BlockError({ text }: { text: string }) {
  return (
    <p className="home-block-error" role="alert">
      {text}
    </p>
  );
}

function BlockEmpty({ text }: { text: string }) {
  return <p className="home-block-empty">{text}</p>;
}

/** Corre la lectura y devuelve null si falla (el bloque muestra su error). */
async function attempt<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    console.error('[home] bloque', err);
    return { ok: false };
  }
}

export async function CrmTasksBlock({ user, locale, hideWhenEmpty }: { user: HomeUser; locale: string; hideWhenEmpty?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  const res = await attempt(() => homeCrmTasks(user));
  if (hideWhenEmpty && res.ok && res.data.total === 0) return null;
  return (
    <BlockFrame product="crm" title={t('today.crm')} href="/app/crm/tasks" viewAll={t('viewAll')} testId="home-crm-tasks">
      {!res.ok ? (
        <BlockError text={t('error')} />
      ) : res.data.items.length === 0 ? (
        <BlockEmpty text={t('today.crmEmpty')} />
      ) : (
        <ul className="home-list">
          {res.data.items.map((task) => (
            <li key={task.id}>
              <Link href={`/app/crm/tasks/${task.id}`} className="home-row">
                <span className="home-row-label">{task.subject}</span>
                <span className={`home-row-meta${task.overdue ? ' is-late' : ''}`}>
                  {task.overdue ? t('today.overdue') : t('today.dueToday')}
                  {task.context ? ` · ${task.context}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlockFrame>
  );
}

export async function TrackIssuesBlock({ user, locale }: { user: HomeUser; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  const res = await attempt(() => homeTrackIssues(user));
  return (
    <BlockFrame product="track" title={t('today.track')} href="/app/track/my-tasks" viewAll={t('viewAll')} testId="home-track">
      {!res.ok ? (
        <BlockError text={t('error')} />
      ) : res.data.items.length === 0 ? (
        <BlockEmpty text={t('today.trackEmpty')} />
      ) : (
        <ul className="home-list">
          {res.data.items.map((issue) => (
            <li key={issue.id}>
              <Link href={`/app/track/issues/${issue.id}`} className="home-row">
                <span className="home-row-label">
                  <span className="home-row-id data">{issue.identifier}</span> {issue.title}
                </span>
                {issue.statusName && <span className="home-row-meta">{issue.statusName}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlockFrame>
  );
}

export async function CalBookingsBlock({ user, locale, timeZone }: { user: HomeUser; locale: string; timeZone: string }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  const res = await attempt(() => homeCalBookings(user));
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }
  return (
    <BlockFrame product="cal" title={t('today.cal')} href="/app/calendar/bookings" viewAll={t('viewAll')} testId="home-cal">
      {!res.ok ? (
        <BlockError text={t('error')} />
      ) : res.data.items.length === 0 ? (
        <BlockEmpty text={t('today.calEmpty')} />
      ) : (
        <ul className="home-list">
          {res.data.items.map((b) => (
            <li key={b.id}>
              <Link href={`/app/calendar/bookings?q=${encodeURIComponent(b.email || b.invitee)}`} className="home-row">
                <span className="home-row-label">
                  <span className="home-row-id data">{fmt.format(parseDbUtc(b.startsAt))}</span> {b.invitee}
                </span>
                <span className="home-row-meta">{b.eventTitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlockFrame>
  );
}

export async function UnreadBlock({ user, locale, hideWhenEmpty }: { user: HomeUser; locale: string; hideWhenEmpty?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  const res = await attempt(() => homeUnread(user));
  if (hideWhenEmpty && res.ok && res.data.chat + res.data.groups === 0) return null;
  return (
    <BlockFrame product="chat" title={t('today.inbox')} href="/app/chat/inbox" viewAll={t('viewAll')} testId="home-unread">
      {!res.ok ? (
        <BlockError text={t('error')} />
      ) : res.data.chat + res.data.groups === 0 ? (
        <BlockEmpty text={t('today.inboxEmpty')} />
      ) : (
        <ul className="home-list">
          {res.data.chat > 0 && (
            <li>
              <Link href="/app/chat/inbox" className="home-row">
                <span className="home-row-label">
                  <ProductGlyph product="chat" size={12} /> {t('today.chatUnread', { n: res.data.chat })}
                </span>
              </Link>
            </li>
          )}
          {res.data.groups > 0 && (
            <li>
              <Link href="/app/groups/inbox" className="home-row">
                <span className="home-row-label">
                  <ProductGlyph product="groups" size={12} /> {t('today.groupsUnread', { n: res.data.groups })}
                </span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </BlockFrame>
  );
}

export async function RecentLoading({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  return (
    <div className="home-recent" aria-busy="true" data-testid="home-recent">
      <div className="home-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className="sr-only">{t('loading')}</p>
    </div>
  );
}

export async function RecentBlock({ user, locale }: { user: HomeUser; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome' });
  const res = await attempt(() => homeRecents(user));
  if (!res.ok) {
    return (
      <div className="home-recent" data-testid="home-recent">
        <BlockError text={t('error')} />
      </div>
    );
  }
  if (res.data.length === 0) {
    return (
      <div className="home-recent" data-testid="home-recent">
        <BlockEmpty text={t('recent.empty')} />
      </div>
    );
  }
  return (
    <ul className="home-recent home-list" data-testid="home-recent">
      {res.data.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <Link href={item.href} className={`home-row card-${item.product}`}>
            <span className="home-row-label">
              <ProductGlyph product={item.product} size={12} />
              <span className="home-row-text">{item.label.trim() || t('recent.untitled')}</span>
            </span>
            <span className="home-row-meta">
              {t(`recent.kinds.${item.kind}`)} · {relDate(item.updatedAt, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
