import { coverColorKey, coverImageSrc } from '@/lib/docs-cover';
import '@/styles/docs-blocks-shared.css';

/** Portada en las vistas de lectura (página compartida, centro de ayuda publicado). */
export function DocsStaticCover({ pageId, value, position = 50 }: { pageId: string; value: string; position?: number }) {
  const color = coverColorKey(value);
  const src = coverImageSrc(pageId, value);
  if (!color && !src) return null;
  return (
    <div className={`docs-cover docs-cover-static${color ? ` docs-cover-color docs-cover-color-${color}` : ''}`} data-testid="docs-cover">
      {src && (
        // URL del usuario o de nuestra ruta con permisos: next/image exigiría allowlist de dominios.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="docs-cover-img" style={{ objectPosition: `center ${position}%` }} />
      )}
    </div>
  );
}
