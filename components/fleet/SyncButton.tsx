'use client';

import { useTranslations } from 'next-intl';
import type { ConnectionDto } from '@/lib/fleet/types';
import { Ago } from './ui';

/** "Actualizar" y cuándo fue la última sincronización con GitHub y Vercel (el cron lo hace cada 5 minutos). */
export default function SyncButton({ onSync, syncing, error, connections }: { onSync: () => void; syncing: boolean; error: string; connections: ConnectionDto[] }) {
  const t = useTranslations('fleet');
  if (!connections.length) return null;
  const last = connections.map((c) => c.lastSyncAt ?? '').sort().pop() || null;
  return (
    <div className="flt-sync">
      {error ? (
        <span className="ui-error" role="alert">
          {t(`errors.${error === 'rate_limited' ? 'rate_limited' : 'sync_failed'}`)}
        </span>
      ) : (
        last && (
          <span className="flt-meta">
            {t('sync.last')} <Ago iso={last} />
          </span>
        )
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onSync} disabled={syncing} aria-busy={syncing} data-testid="fleet-sync">
        {syncing ? t('sync.syncing') : t('sync.refresh')}
      </button>
    </div>
  );
}
