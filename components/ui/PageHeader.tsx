import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Cabecera de página de la app: título en señalética (Archivo angosta 800),
 * una línea de ayuda opcional y las acciones a la derecha. Cierra con el
 * filete de 4px de tinta. Una sola acción primaria (.btn-primary) por página.
 *
 *   <PageHeader title="Contactos" description="…" actions={<Link className="btn btn-primary" href="…">Crear contacto</Link>} />
 */
export default function PageHeader({
  title,
  description,
  actions,
  back,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Link de vuelta para páginas de detalle. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={`ui-page-header ${className}`.trim()}>
      <div className="ui-page-header-text">
        {back && (
          <Link href={back.href} className="ui-page-back">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {back.label}
          </Link>
        )}
        <h1 className="ui-page-title">{title}</h1>
        {description && <p className="ui-page-desc">{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}
