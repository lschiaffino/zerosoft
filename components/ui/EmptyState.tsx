import { isValidElement, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import type { ProductKey } from '@/lib/products';

type Action = { label: string; href: string } | ReactNode;

function renderAction(action: Action, className: string) {
  if (action && typeof action === 'object' && !isValidElement(action) && 'href' in action) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return action as ReactNode;
}

/**
 * Estado vacío: un tramo de la línea con su estación, qué va acá y UNA acción
 * primaria. `secondary` es el atajo o la importación ("o importá un CSV").
 * El tramo toma el color de la línea activa (--accent) o el de `product`.
 *
 *   <EmptyState title="Todavía no hay links" body="…" action={{ label: 'Crear link', href: '/app/links/new' }}
 *     secondary={<>o <Link href="/app/settings#domains">importá desde Bitly</Link></>} />
 */
export default function EmptyState({
  title,
  body,
  action,
  secondary,
  product,
  quiet = false,
  compact = false,
  className = '',
}: {
  /** Sin título solo cuando es `compact`. */
  title?: ReactNode;
  body?: ReactNode;
  /** `{ label, href }` o un botón propio (p. ej. <button className="btn btn-primary">). */
  action?: Action;
  /** Atajo o import, en texto chico debajo de la acción. */
  secondary?: ReactNode;
  product?: ProductKey;
  /** Sin borde: para vacíos dentro de un panel o una tabla. */
  quiet?: boolean;
  /**
   * Dentro de una sección que ya tiene su título: solo el texto y la acción,
   * sin estación ni titular (si no, el vacío grita más que la sección).
   */
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={`ui-empty ui-empty-compact ${className}`.trim()}>
        <p className="ui-empty-body">{body ?? title}</p>
        {(action || secondary) && (
          <div className="ui-empty-actions">
            {action && renderAction(action, 'btn btn-secondary btn-sm')}
            {secondary && <span className="ui-empty-alt">{secondary}</span>}
          </div>
        )}
      </div>
    );
  }
  const stroke = product ? `var(--c-${product})` : 'var(--accent)';
  return (
    <div className={`ui-empty${quiet ? ' ui-empty-quiet' : ''} ${className}`.trim()}>
      <svg className="ui-empty-glyph" viewBox="0 0 300 100" width="72" height="24" aria-hidden="true" focusable="false">
        <line x1="18" y1="50" x2="282" y2="50" stroke={stroke} strokeWidth="36" strokeLinecap="round" />
        <circle cx="150" cy="50" r="39" fill="#ffffff" stroke="#111111" strokeWidth="22" />
      </svg>
      {title && <h2 className="ui-empty-title">{title}</h2>}
      {body && <p className="ui-empty-body">{body}</p>}
      {(action || secondary) && (
        <div className="ui-empty-actions">
          {action && renderAction(action, 'btn btn-primary')}
          {secondary && <span className="ui-empty-alt">{secondary}</span>}
        </div>
      )}
    </div>
  );
}
