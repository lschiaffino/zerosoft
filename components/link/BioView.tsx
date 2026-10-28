import type { BioTheme } from '@/lib/link-bio-theme';
import { accentInk } from '@/lib/link-bio-theme';

export interface BioViewProps {
  title: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
  links: Array<{ id: string; title: string; href: string }>;
  theme: BioTheme;
  accent: string | null;
  /** Vista previa del editor: los botones no navegan y el contenedor no ocupa la pantalla. */
  preview?: boolean;
  emptyLabel?: string;
}

/**
 * La página link-in-bio. La usan la página pública (/@handle) y la vista
 * previa en vivo del editor: lo que se ve al editar es lo que se publica.
 * Sin hooks: sirve en el servidor y en el cliente.
 */
export default function BioView({ title, handle, bio, avatarUrl, links, theme, accent, preview = false, emptyLabel }: BioViewProps) {
  const style = accent ? ({ '--bio-accent': accent, '--bio-accent-ink': accentInk(accent) } as React.CSSProperties) : undefined;
  const Root = preview ? 'div' : 'main';
  return (
    <Root className={`bio-page${preview ? ' bio-page-preview' : ''}`} data-bio-theme={theme} data-bio-accent={accent ? '' : undefined} style={style}>
      <div className="bio-card">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="bio-avatar" />
        ) : (
          <span className="bio-avatar bio-avatar-fallback mono">{(title || handle || '?').slice(0, 1).toUpperCase()}</span>
        )}
        {preview ? <p className="bio-title">{title}</p> : <h1 className="bio-title">{title}</h1>}
        {handle && <p className="bio-handle mono">@{handle}</p>}
        {bio && <p className="bio-text">{bio}</p>}
        {links.length === 0 && emptyLabel ? (
          <p className="bio-handle">{emptyLabel}</p>
        ) : (
          <ul className="bio-links">
            {links.map((l) => (
              <li key={l.id}>
                {preview ? (
                  <span className="bio-link">{l.title}</span>
                ) : (
                  <a className="bio-link" href={l.href} rel="noopener">
                    {l.title}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Root>
  );
}
