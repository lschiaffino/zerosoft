'use client';

import { useTranslations } from 'next-intl';
import type { SlaComputedFields } from '@/lib/chat-data';
import { formatSlaAge } from './inbox-model';

type SlaFields = SlaComputedFields & { resolved_at: string | null };

/**
 * Estado del SLA como texto de tinta: "1ª respuesta vencida hace 12m" o
 * "Responder en 24m". Sin placa: en la fila de la bandeja la única placa es
 * Urgente. Lo usan la lista y la cabecera del hilo.
 */
export default function SlaNote({ c }: { c: SlaFields }) {
  const t = useTranslations('chat');
  if (c.sla_breached === 1) {
    const first = c.sla_breach_kind !== 'resolution';
    const text =
      c.sla_overdue_minutes != null
        ? t(first ? 'sla.breachedFirstAgo' : 'sla.breachedResolutionAgo', { age: formatSlaAge(c.sla_overdue_minutes) })
        : t(first ? 'sla.breachedFirst' : 'sla.breachedResolution');
    return (
      <span className="chat-sla" data-breached="">
        {text}
      </span>
    );
  }
  if (!c.resolved_at && c.sla_due_in_minutes != null) {
    return <span className="chat-sla">{t('sla.dueIn', { age: formatSlaAge(c.sla_due_in_minutes) })}</span>;
  }
  return null;
}
