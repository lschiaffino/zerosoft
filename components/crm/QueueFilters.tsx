'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface QueueFiltersProps {
  scope: string;
  scopes: string[];
  owner: string;
  people: Array<{ value: string; label: string }>;
  /** Cola con nombre activa ('' = ninguna) y las que la persona ve. */
  queue?: string;
  queues?: Array<{ value: string; label: string }>;
  /** Filtros de la vista desde la que se empezó (tipo, prioridad, proyecto, texto): se conservan. */
  extra?: Record<string, string>;
}

/** Qué tareas entran en la cola (vencidas, de hoy, próximas o todas), de quién y de qué cola. */
export default function QueueFilters({ scope, scopes, owner, people, queue = '', queues = [], extra = {} }: QueueFiltersProps) {
  const t = useTranslations('crm');
  const router = useRouter();

  function go(next: { scope?: string; owner?: string; queue?: string }) {
    const params = new URLSearchParams();
    const s = next.scope ?? scope;
    const o = next.owner ?? owner;
    const q = next.queue ?? queue;
    if (s !== 'due') params.set('scope', s);
    if (o) params.set('owner', o);
    for (const [k, v] of Object.entries(extra)) if (k !== 'queue' && v) params.set(k, v);
    if (q) params.set('queue', q);
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
      {queues.length > 0 && (
        <select
          className="filter-select"
          value={queue}
          onChange={(e) => go({ queue: e.target.value, ...(e.target.value ? { owner: 'all', scope: 'all' } : {}) })}
          aria-label={t('tasks.queues.filter')}
          data-testid="queue-named-select"
        >
          <option value="">{t('tasks.queues.none')}</option>
          {queues.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
