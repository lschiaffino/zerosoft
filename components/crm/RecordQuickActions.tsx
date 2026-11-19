'use client';

import { useTranslations } from 'next-intl';
import { COMPOSE_REQUEST_EVENT, type ComposeType } from './recordLayout';

// Trazo 2, 24×24, como CrmIcon. Decorativos: el botón lleva el texto.
const ICONS: Record<ComposeType, string> = {
  note: 'M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h5',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  call: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z',
  task: 'M4 4h16v16H4zM8 12l3 3 5-6',
  meeting: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

/**
 * Acciones rápidas de la ficha, como la fila de HubSpot: cada botón abre el
 * composer del timeline en ese tipo de actividad. No crean nada por su cuenta:
 * es el mismo composer de siempre, a un clic desde cualquier pestaña.
 */
export default function RecordQuickActions({ types }: { types: readonly ComposeType[] }) {
  const t = useTranslations('crm');

  // La ficha (RecordShell) pasa a la pestaña Actividad y le avisa al timeline.
  function open(type: ComposeType) {
    window.dispatchEvent(new CustomEvent(COMPOSE_REQUEST_EVENT, { detail: { type } }));
  }

  return (
    <div className="rec-quick" role="group" aria-label={t('record.quickActions')}>
      {types.map((type) => (
        <button
          key={type}
          type="button"
          className="btn btn-secondary btn-sm rec-quick-btn"
          data-compose={type}
          data-testid={`record-quick-${type}`}
          onClick={() => open(type)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden="true"
          >
            <path d={ICONS[type]} />
          </svg>
          <span>{t(`enums.activityType.${type}`)}</span>
        </button>
      ))}
    </div>
  );
}
