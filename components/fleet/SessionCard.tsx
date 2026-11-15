'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { SessionDto } from '@/lib/fleet/types';
import { Ago, ChecksMark, DeployMark, StatusLabel } from './ui';

/** Tarjeta de una sesión de agente: estado, última actividad, qué dijo y su PR y deploy. Abre el chat. */
export default function SessionCard({ s }: { s: SessionDto }) {
  const t = useTranslations('fleet');
  return (
    <article className="flt-card" data-testid="fleet-session-card" data-session={s.id} data-status={s.status}>
      <div className="flt-card-top">
        <StatusLabel status={s.status} />
        <Ago iso={s.lastEventAt} className="flt-meta" />
      </div>
      <h3 className="flt-card-title">
        <Link href={`/app/fleet/chats/${s.id}`} className="flt-card-link">
          {s.title}
        </Link>
      </h3>
      {(s.branch || s.orcaWorktree || s.orcaPane) && (
        <p className="flt-card-meta">
          {s.branch && <span className="flt-mono">{s.branch}</span>}
          {(s.orcaWorktree || s.orcaPane) && <span>{t('card.orca')}</span>}
        </p>
      )}
      {s.lastText && <p className="flt-card-text">{s.lastText}</p>}
      {(s.pr || s.deploy || s.unread > 0 || s.pending > 0) && (
        <div className="flt-card-foot">
          {s.pr && (
            <a href={s.pr.url} target="_blank" rel="noopener noreferrer" className="flt-chip-link" data-testid="fleet-card-pr">
              <ChecksMark state={s.pr.checks} />
              {t('card.pr', { n: s.pr.number })}
              {s.pr.autoMerge && <span className="flt-meta">{t('card.autoMerge')}</span>}
            </a>
          )}
          {s.deploy && (
            <a href={s.deploy.url} target="_blank" rel="noopener noreferrer" className="flt-chip-link" data-testid="fleet-card-deploy">
              <DeployMark state={s.deploy.state} />
            </a>
          )}
          <span className="flt-grow" />
          {s.pending > 0 && (
            <span className="flt-meta" data-testid="fleet-card-pending">
              {t('card.pending', { n: s.pending })}
            </span>
          )}
          {s.unread > 0 && (
            <span className="flt-unread" data-testid="fleet-card-unread" aria-label={t('card.unread', { n: s.unread })}>
              {s.unread}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
