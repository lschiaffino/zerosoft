import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { parseDbUtc } from '@/lib/utils';
import RecordLayoutTabs from './RecordLayoutTabs';
import RecordQuickActions from './RecordQuickActions';
import { middlePanelFor, recordInitials, type ComposeType, type LayoutTab } from './recordLayout';

/**
 * Ficha de un registro en tres columnas, como la de HubSpot:
 * - izquierda: identidad, acciones rápidas y las tarjetas de propiedades;
 * - medio: pestañas Resumen / Actividad;
 * - derecha: tarjetas de asociaciones.
 * En pantalla angosta (styles/crm-record-layout.css) queda una columna: la
 * identidad arriba y cuatro pestañas, con propiedades y asociaciones entre
 * ellas. Todo se renderiza siempre; el CSS decide qué se ve según `data-tab`.
 */
export default function RecordColumns({
  tab,
  base,
  back,
  before,
  actions,
  identity,
  about,
  aboutLabel,
  lead,
  overview,
  activity,
  right,
  rightLabel,
}: {
  tab: LayoutTab;
  /** Ruta del registro sin locale (`/app/crm/contacts/<id>`). */
  base: string;
  back: { href: string; label: string };
  /** Arriba de todo (la jerarquía de empresas). */
  before?: ReactNode;
  /** Acciones que no son del día a día: playbooks, firma, agendar, menú Más. */
  actions?: ReactNode;
  identity: ReactNode;
  about: ReactNode;
  aboutLabel: string;
  /** Arriba de las pestañas, a la vista en todas (la etapa del deal). */
  lead?: ReactNode;
  overview: ReactNode;
  activity: ReactNode;
  right: ReactNode;
  rightLabel: string;
}) {
  const panel = middlePanelFor(tab);
  return (
    <div className="ui-page record-page rec3-page">
      {before}
      <div className="rec-topbar">
        <Link href={back.href} className="ui-page-back">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {back.label}
        </Link>
        {actions && <div className="ui-page-actions rec-topbar-actions">{actions}</div>}
      </div>
      <div className="rec3" data-tab={tab} data-testid="record-columns">
        <div className="rec3-left" data-testid="record-left">
          <div className="rec3-identity">{identity}</div>
          <section className="rec3-about record-props" aria-label={aboutLabel} data-testid="record-about">
            {about}
          </section>
        </div>
        <div className="rec3-mid" data-testid="record-middle">
          {lead && <div className="rec3-lead">{lead}</div>}
          <RecordLayoutTabs base={base} tab={tab} />
          <div className="rec3-panel" data-panel={panel} data-testid={`record-panel-${panel}`}>
            {panel === 'overview' ? overview : activity}
          </div>
        </div>
        <aside className="rec3-right record-related" aria-label={rightLabel} data-testid="record-right">
          {right}
        </aside>
      </div>
    </div>
  );
}

/** Nombre, avatar, línea clave, etiquetas y acciones rápidas: la cabecera de la columna izquierda. */
export function RecordIdentity({
  name,
  avatar,
  keyLine,
  tags,
  base,
  quick,
}: {
  name: string;
  /** Por defecto, las iniciales del nombre. `null` saca el avatar (deals). */
  avatar?: ReactNode | null;
  keyLine?: ReactNode;
  tags?: ReactNode;
  base: string;
  quick: readonly ComposeType[];
}) {
  return (
    <>
      <div className="rec-identity">
        {avatar === undefined ? (
          <span className="rec-avatar" aria-hidden="true">
            {recordInitials(name)}
          </span>
        ) : (
          avatar
        )}
        <div className="rec-identity-text">
          <h1 className="rec-name">{name}</h1>
          {keyLine && <div className="rec-keyline record-meta">{keyLine}</div>}
        </div>
      </div>
      {tags}
      <RecordQuickActions base={base} types={quick} />
    </>
  );
}

export interface RecentActivityItem {
  id: string;
  type: string;
  subject: string;
  body: string;
  created_at: string;
}

/** Resumen: las últimas actividades, solo lectura, con el link a la pestaña Actividad. */
export function RecordRecentActivity({
  items,
  locale,
  title,
  emptyLabel,
  moreLabel,
  moreHref,
  typeLabels,
}: {
  items: RecentActivityItem[];
  locale: string;
  title: string;
  emptyLabel: string;
  moreLabel: string;
  moreHref: string;
  /** Nombre de cada tipo de actividad (nota, tarea, llamada, reunión, email). */
  typeLabels: Record<string, string>;
}) {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <section className="rec-overview-block" data-testid="record-recent-activity">
      <h2 className="rec-overview-title">{title}</h2>
      {items.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <ul className="rec-recent">
          {items.map((item) => (
            <li key={item.id}>
              <span className="rec-recent-type">{typeLabels[item.type] ?? item.type}</span>
              <span className="rec-recent-text">{item.subject || item.body || '—'}</span>
              <time className="rec-recent-date num" dateTime={item.created_at}>
                {fmt.format(parseDbUtc(item.created_at))}
              </time>
            </li>
          ))}
        </ul>
      )}
      <Link href={moreHref} className="record-summary-more">
        {moreLabel}
      </Link>
    </section>
  );
}
