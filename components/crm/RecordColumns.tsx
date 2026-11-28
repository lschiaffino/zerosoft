import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { parseDbUtc } from '@/lib/utils';
import RecordShell from './RecordShell';
import RecordQuickActions from './RecordQuickActions';
import { RecordTopNav } from './RecordNav';
import { recordInitials, type ComposeType, type LayoutTab } from './recordLayout';

/**
 * Ficha de un registro en tres columnas, como la de HubSpot:
 * - izquierda: identidad, acciones rápidas y las tarjetas de propiedades;
 * - medio: pestañas Resumen / Actividad;
 * - derecha: tarjetas de asociaciones.
 * En pantalla angosta (styles/crm-record-layout.css) queda una columna: la
 * identidad arriba y cuatro pestañas, con propiedades y asociaciones entre
 * ellas. El server arma todo; RecordShell (cliente) cambia de pestaña sin
 * volver a pedir la ficha.
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
  return (
    <div className="ui-page record-page rec3-page">
      {before}
      <div className="rec-topbar">
        {/* Volver a la lista de donde vino (con sus filtros), ‹ › entre sus registros y la ficha en vivo. */}
        <RecordTopNav base={base} back={back} />
        {actions && <div className="ui-page-actions rec-topbar-actions">{actions}</div>}
      </div>
      <RecordShell
        tab={tab}
        base={base}
        identity={identity}
        about={about}
        aboutLabel={aboutLabel}
        lead={lead}
        overview={overview}
        activity={activity}
        right={right}
        rightLabel={rightLabel}
      />
    </div>
  );
}

/** Nombre, avatar, línea clave, etiquetas y acciones rápidas: la cabecera de la columna izquierda. */
export function RecordIdentity({
  name,
  avatar,
  keyLine,
  tags,
  quick,
}: {
  name: string;
  /** Por defecto, las iniciales del nombre. `null` saca el avatar (deals). */
  avatar?: ReactNode | null;
  keyLine?: ReactNode;
  tags?: ReactNode;
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
      <RecordQuickActions types={quick} />
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

/** Resumen: las últimas comunicaciones (emails, llamadas, reuniones), solo lectura, con el link a Actividad. */
export function RecordRecentCommunications({
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
  /** Nombre de cada tipo de actividad (llamada, reunión, email). */
  typeLabels: Record<string, string>;
}) {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <section className="rec-overview-block" data-testid="record-recent-communications">
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
      <Link href={moreHref} className="record-summary-more" data-testid="record-see-activity">
        {moreLabel}
      </Link>
    </section>
  );
}

export interface AssociationSummaryRow {
  id: string;
  name: string;
  href: string;
  meta?: string;
}

/**
 * Resumen: una tabla corta por asociación (las primeras cinco), con los mismos
 * registros que las tarjetas de la derecha: ya vienen filtrados por el alcance
 * de quien mira.
 */
export function RecordAssociationSummary({
  testId,
  title,
  rows,
  emptyLabel,
  moreLabel,
}: {
  testId: string;
  title: string;
  rows: AssociationSummaryRow[];
  emptyLabel: string;
  /** "y N más", cuando hay más de cinco. */
  moreLabel?: string;
}) {
  return (
    <section className="rec-overview-block" data-testid={testId}>
      <h2 className="rec-overview-title">
        {title}
        <span className="rec-card-count num">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <ul className="rec-assoc-summary">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id}>
              <Link href={row.href}>{row.name}</Link>
              {row.meta && <span className="muted">{row.meta}</span>}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 5 && moreLabel && <p className="muted rec-assoc-more">{moreLabel}</p>}
    </section>
  );
}
