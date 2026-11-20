'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import SettingsSearch from './SettingsSearch';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { activeRouteTab, legacySettingsTarget } from '@/lib/settings-nav';

export interface PlatformNavItem {
  key: string;
  href: string;
  match?: string[];
  label: string;
  keywords?: string;
  product?: string;
  native?: string;
}

export interface PlatformNavGroup {
  key: string;
  label: string;
  items: PlatformNavItem[];
}

/**
 * Nav lateral de Ajustes: grupos con rótulo (Cuenta, Workspace, Este
 * dispositivo, Productos) que marcan la sección abierta. Arriba, la búsqueda
 * de Ajustes (SettingsSearch): con texto, la lista se cambia por los ajustes
 * que coinciden (de todas las secciones y apps). Flechas recorren la lista.
 * Bajo 1180px la lista pasa a un select arriba del contenido (la búsqueda
 * sigue arriba). También manda los anchors viejos
 * (/app/settings/workspace#api) a su sección nueva.
 *
 * `embed`: dentro de la ventana de Ajustes del escritorio. Ahí también se
 * marcan los productos (la nav está en todas las rutas de ajustes) y las
 * secciones nativas son links comunes: la app intercepta la navegación y
 * abre la sección en su página local.
 */
export default function PlatformSettingsNav({
  groups,
  label,
  selectLabel,
  embed = false,
}: {
  groups: PlatformNavGroup[];
  label: string;
  selectLabel: string;
  embed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const navRef = useRef<HTMLElement>(null);
  const all = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // En /app/settings solo se marcan las secciones propias: los productos viven en otras rutas.
  const markable = embed ? all : all.filter((i) => !i.product);
  const active = activeRouteTab(markable, pathname);

  useEffect(() => {
    const target = legacySettingsTarget(pathname, window.location.hash);
    if (target) router.replace(target);
  }, [pathname, router]);

  const searching = q.trim() !== '';

  function onSelect(e: ChangeEvent<HTMLSelectElement>) {
    const item = all.find((i) => i.key === e.target.value);
    if (!item) return;
    if (item.native) window.location.assign(item.href);
    else router.push(item.href);
  }

  function links(): HTMLAnchorElement[] {
    return Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>('a.st-nav-link') ?? []);
  }

  function onNavKey(e: KeyboardEvent<HTMLElement>) {
    const list = links();
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    let next: HTMLAnchorElement | undefined;
    if (e.key === 'ArrowDown') next = list[i + 1];
    else if (e.key === 'ArrowUp') next = list[i - 1];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    if (e.key === 'ArrowUp' && i === 0) {
      e.preventDefault();
      navRef.current?.closest('.st-nav-wrap')?.querySelector<HTMLInputElement>('.st-search-input')?.focus();
      return;
    }
    if (!next) return;
    e.preventDefault();
    next.focus();
  }

  const swatch = (i: PlatformNavItem) =>
    i.product ? <i className="st-nav-swatch" style={{ background: `var(--c-${i.product})` }} aria-hidden="true" /> : null;

  return (
    <div className={`st-nav-wrap${embed ? ' st-nav-embed' : ''}`}>
      <div className="st-nav-select">
        <label className="label" htmlFor="st-nav-select">
          {selectLabel}
        </label>
        <select id="st-nav-select" className="select" value={active ?? ''} onChange={onSelect}>
          {groups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="st-nav-search">
        <SettingsSearch variant="nav" onQueryChange={setQ} />
      </div>
      <nav className="st-nav" aria-label={label} ref={navRef} onKeyDown={onNavKey} hidden={searching}>
        {groups.map((g) => (
          <div key={g.key} className="st-nav-group" role="group" aria-labelledby={`st-nav-${g.key}`}>
            <p id={`st-nav-${g.key}`} className="st-nav-heading">
              {g.label}
            </p>
            {g.items.map((i) =>
              i.native ? (
                // Sección nativa del escritorio: navegación completa, la app la intercepta.
                <a key={i.key} href={i.href} className="ui-settings-link st-nav-link" aria-current={i.key === active ? 'page' : undefined}>
                  {i.label}
                </a>
              ) : (
                <Link
                  key={i.key}
                  href={i.href}
                  prefetch={false}
                  className="ui-settings-link st-nav-link"
                  aria-current={i.key === active ? 'page' : undefined}
                >
                  {swatch(i)}
                  {i.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
