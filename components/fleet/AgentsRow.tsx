'use client';

import { Link } from '@/i18n/navigation';

export interface AgentsRowProps {
  href: string;
  label: string;
  /** Mensajes sin leer de los agentes. */
  unread: number;
  /** Agentes que te esperan (aviso de permiso o pregunta). */
  waiting: number;
  waitingLabel: string;
}

/**
 * Fila "Agentes" arriba de la lista de chats de Inbox y de Lines (como la de "Archivados" de WhatsApp): abre los
 * chats con los agentes de Fleet dentro de la app. Solo aparece si la persona la prendió en los ajustes de Fleet.
 */
export default function AgentsRow({ href, label, unread, waiting, waitingLabel }: AgentsRowProps) {
  return (
    <Link href={href} className="wa-archived-row flt-agents-row" data-testid="fleet-agents-row">
      <span className="wa-archived-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="8" height="7" rx="1.5" />
          <rect x="13" y="4" width="8" height="7" rx="1.5" />
          <rect x="3" y="13" width="8" height="7" rx="1.5" />
          <rect x="13" y="13" width="8" height="7" rx="1.5" />
        </svg>
      </span>
      <span className="wa-archived-label">
        {label}
        {waiting > 0 && <span className="flt-agents-row-sub"> · {waitingLabel}</span>}
      </span>
      {unread > 0 && <span className="wa-archived-count">{unread}</span>}
    </Link>
  );
}
