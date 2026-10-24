'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface QueueFiltersProps {
  scope: string;
  scopes: string[];
  owner: string;
  people: Array<{ value: string; label: string }>;
}

/** Qué tareas entran en la cola (vencidas, de hoy o ambas) y de quién. */
export default function QueueFilters({ scope, scopes, owner, people }: QueueFiltersProps) {
  const t = useTranslations('crm');
  const router = useRouter();

  function go(next: { scope?: string; owner?: string }) {
    const params = new URLSearchParams();
    const s = next.scope ?? scope;
    const o = next.owner ?? owner;
    if (s !== 'due') params.set('scope', s);
    if (o) params.set('owner', o);
    router.push(`/app/crm/tasks/queue${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <span className="wq-filters">
      <select className="filter-select" value={scope} onChange={(e) => go({ scope: e.target.value })} aria-label={t('queue.scopeLabel')}>
        {scopes.map((s) => (
          <option key={s} value={s}>
            {t(`queue.scope.${s}`)}
          </option>
        ))}
      </select>
      {people.length > 1 && (
        <select className="filter-select" value={owner} onChange={(e) => go({ owner: e.target.value })} aria-label={t('tasks.filterOwner')}>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="all">{t('queue.everyone')}</option>
        </select>
      )}
    </span>
  );
}
