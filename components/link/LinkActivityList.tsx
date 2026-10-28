import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { LinkActivityRow } from '@/lib/link-activity';
import { formatDateTime } from '@/lib/utils';

const FIELD_KEYS = new Set([
  'url',
  'slug',
  'title',
  'tags',
  'expiresAt',
  'maxClicks',
  'redirectType',
  'ogTitle',
  'ogDescription',
  'ogImage',
  'forwardParams',
  'expiredUrl',
  'targeting',
  'externalId',
  'folderId',
  'trackConversion',
  'cloak',
  'password',
  'reason',
]);

/**
 * Registro de actividad (servidor): quién, qué y cuándo, con el antes y el
 * después de cada campo. `showLink` agrega el link (vista del workspace).
 */
export default async function LinkActivityList({
  locale,
  rows,
  showLink = false,
  moreHref,
}: {
  locale: string;
  rows: LinkActivityRow[];
  showLink?: boolean;
  /** Página siguiente (?before=…), si hay. */
  moreHref?: string | null;
}) {
  const t = await getTranslations({ locale, namespace: 'link' });
  if (rows.length === 0) return <p className="lk-empty-line">{t('activity.empty')}</p>;
  const value = (v: string | null) => (v === null || v === '' ? t('activity.none') : v.length > 120 ? `${v.slice(0, 119)}…` : v);
  return (
    <>
      <ol className="lk-activity" data-testid="link-activity">
        {rows.map((r) => {
          const changes = r.changes ? Object.entries(r.changes).filter(([k]) => FIELD_KEYS.has(k)) : [];
          return (
            <li key={r.id} className="lk-activity-item">
              <div className="lk-activity-head">
                <span className={`badge lk-act-${r.action}`}>{t(`activity.action.${r.action}`)}</span>
                {showLink &&
                  (r.link_id && r.action !== 'deleted' ? (
                    <Link href={`/app/links/${r.link_id}?tab=activity`} className="cell-link data">
                      /{r.slug}
                    </Link>
                  ) : (
                    <span className="data">/{r.slug}</span>
                  ))}
                <span className="lk-activity-who">
                  {r.actor_name ?? (r.via === 'system' ? t('activity.system') : t('activity.unknown'))}
                  {r.via !== 'app' && r.via !== 'system' ? ` · ${t(`activity.via.${r.via}`)}` : ''}
                </span>
                <time className="lk-activity-when data" dateTime={r.created_at}>
                  {formatDateTime(r.created_at, locale)}
                </time>
              </div>
              {changes.length > 0 && (
                <dl className="lk-activity-changes">
                  {changes.map(([k, v]) => (
                    <div key={k} className="lk-activity-change">
                      <dt>{t(`activity.field.${k}`)}</dt>
                      <dd>
                        {Array.isArray(v) ? (
                          <>
                            <span className="lk-activity-from">{value(v[0])}</span>
                            <span aria-hidden="true"> → </span>
                            <span className="sr-only">{t('activity.to')}</span>
                            <span className="lk-activity-to">{value(v[1])}</span>
                          </>
                        ) : k === 'password' || k === 'reason' ? (
                          t(`activity.value.${String(v)}`)
                        ) : (
                          value(String(v))
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
      {moreHref && (
        <p>
          <Link href={moreHref} className="btn btn-sm" scroll={false}>
            {t('activity.more')}
          </Link>
        </p>
      )}
    </>
  );
}
