import { iconImageUrl, pageImageHref } from '@/lib/docs-files';
import DocsGlyph from './DocsGlyphs';
import '@/styles/docs-blocks-shared.css';

/**
 * Ícono de una página: emoji, imagen subida ("img:<url>", servida por
 * /api/docs/files/<página>/icon con el chequeo de acceso) o, si no hay y se
 * pide `fallback`, el documento genérico. Lo usan el sidebar, la búsqueda,
 * los breadcrumbs, la lista de páginas y el centro de ayuda.
 */
export default function DocsPageIcon({
  icon,
  pageId,
  size = 16,
  fallback = false,
  className = '',
}: {
  icon: string | null | undefined;
  pageId: string;
  size?: number;
  fallback?: boolean;
  className?: string;
}) {
  if (iconImageUrl(icon)) {
    return (
      // Servida por nuestra API con permisos: next/image no aplica.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`docs-page-icon-img ${className}`.trim()}
        src={pageImageHref(pageId, 'icon', icon!)}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
        loading="lazy"
      />
    );
  }
  if (icon && !icon.startsWith('img:')) {
    return (
      <span className={`docs-page-icon-emoji ${className}`.trim()} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return fallback ? <DocsGlyph name="page" size={size} /> : null;
}
