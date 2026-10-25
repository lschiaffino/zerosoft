'use client';

import { useEffect, type ChangeEvent } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { activeRouteTab, legacySettingsTarget } from '@/lib/settings-nav';
import type { ProductKey } from '@/lib/products';

export interface PlatformNavItem {
  key: string;
  href: string;
  match?: string[];
  label: string;
  product?: ProductKey;
}

export interface PlatformNavGroup {
  key: string;
  label: string;
  items: PlatformNavItem[];
}

/**
 * Nav lateral de los Ajustes de la plataforma: dos grupos (Cuenta y
 * workspace, Productos) que marcan la sección abierta. Bajo 900px pasa a un
 * select arriba del contenido. También manda los anchors viejos
 * (/app/settings/workspace#api) a su sección nueva.
 */
export default function PlatformSettingsNav({
  groups,
  label,
  selectLabel,
}: {
  groups: PlatformNavGroup[];
  label: string;
  selectLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Solo las secciones de la plataforma se marcan: los productos viven en otras rutas.
  const own = groups.flatMap((g) => g.items).filter((i) => !i.product);
  const active = activeRouteTab(own, pathname);

  useEffect(() => {
    const target = legacySettingsTarget(pathname, window.location.hash);
    if (target) router.replace(target);
  }, [pathname, router]);

  function onSelect(e: ChangeEvent<HTMLSelectElement>) {
    const item = groups.flatMap((g) => g.items).find((i) => i.key === e.target.value);
    if (item) router.push(item.href);
  }

  return (
    <div className="st-nav-wrap">
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
      <nav className="st-nav" aria-label={label}>
        {groups.map((g) => (
          <div key={g.key} className="st-nav-group" role="group" aria-labelledby={`st-nav-${g.key}`}>
            <p id={`st-nav-${g.key}`} className="st-nav-heading">
              {g.label}
            </p>
            {g.items.map((i) => (
              <Link
                key={i.key}
                href={i.href}
                prefetch={false}
                className="ui-settings-link st-nav-link"
                aria-current={i.key === active ? 'page' : undefined}
              >
                {i.product && <i className="st-nav-swatch" style={{ background: `var(--c-${i.product})` }} aria-hidden="true" />}
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
