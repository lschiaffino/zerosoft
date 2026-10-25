'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';
import { clearOfflineData } from '@/lib/offline-queue';
import { useTranslations } from 'next-intl';
import { TZ_CHANGED_EVENT } from '@/lib/tz-client';
import { collapsedFrom, denseRoute, storageKey } from '@/lib/sidebar-collapsed';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from './icons';
import {
  appProductFromPath,
  appProductOf,
  buildNav,
  buildNewItems,
  settingsNavItem,
  switcherHref,
  SWITCHER_PRODUCTS,
  type SidebarLabels,
} from './sidebar-nav';
import { PRODUCT_CONFIG, isBuildingProduct, type ProductKey } from '@/lib/products';
import { DEFAULT_WORKSPACE_MODE, featuredApps, moreAppsByCategory, type WorkspaceMode } from '@/lib/workspace-mode';
import NotificationBell from './NotificationBell';
import Logo from '@/components/brand/Logo';
import ProductGlyph from '@/components/brand/ProductGlyph';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';

export type { SidebarLabels };

interface SideUser {
  name: string | null;
  email: string;
  image: string | null;
}


function readCollapsed(dense: string | null): boolean {
  try {
    return collapsedFrom(window.localStorage.getItem(storageKey(dense)), dense);
  } catch {
    return dense != null;
  }
}

function writeCollapsed(dense: string | null, v: boolean) {
  try {
    window.localStorage.setItem(storageKey(dense), v ? '1' : '0');
  } catch {
    // Sin storage (modo privado): el estado vive solo en esta pestaña.
  }
}

/**
 * Índice del ítem en la columna de al lado (dir 1 = derecha, -1 = izquierda):
 * el más cercano en altura entre los que empiezan del otro lado. null si no hay.
 */
function sideItem(items: HTMLElement[], i: number, dir: 1 | -1): number | null {
  const from = items[i]?.getBoundingClientRect();
  if (!from) return null;
  const cy = from.top + from.height / 2;
  let best: number | null = null;
  let bestScore = Infinity;
  items.forEach((el, j) => {
    if (j === i) return;
    const r = el.getBoundingClientRect();
    const beside = dir === 1 ? r.left >= from.right - 1 : r.right <= from.left + 1;
    if (!beside) return;
    const score = Math.abs(r.top + r.height / 2 - cy) * 4 + Math.abs(dir === 1 ? r.left - from.right : from.left - r.right);
    if (score < bestScore) {
      bestScore = score;
      best = j;
    }
  });
  return best;
}

/** Mueve el foco entre los ítems de un menú con flechas, Home y End. */
function menuKeys(e: KeyboardEvent<HTMLElement>, close: () => void) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => {
    e.preventDefault();
    items[(n + items.length) % items.length]?.focus();
  };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // En la grilla del switcher, ←/→ van a la columna de al lado (el más cercano en altura); en una lista, siguiente/anterior.
    const side = sideItem(items, i, e.key === 'ArrowRight' ? 1 : -1);
    go(side ?? i + (e.key === 'ArrowRight' ? 1 : -1));
  }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'Tab') close();
}

/**
 * Chrome de las apps: una banda arriba (marca, switcher de productos,
 * sección, búsqueda, avisos) y el sidebar del producto. La banda es blanca
 * con un filete y cada ítem lleva su ícono; el activo se marca con el color
 * del producto. Colapsado (≥1024px) quedan los íconos; en <1024px es un
 * drawer.
 */
export default function AppSidebar({
  labels,
  user,
  demo,
  tasksDue = 0,
  teamName = null,
  crumb = null,
  mode = DEFAULT_WORKSPACE_MODE,
  docsCanCreate = true,
}: {
  /** Puede crear páginas de Docs de primer nivel (si no, el "+ Nuevo" no las ofrece). */
  docsCanCreate?: boolean;
  /** Modo del workspace: ordena el switcher (destacadas y "Más apps"). */
  mode?: WorkspaceMode;
  labels: SidebarLabels;
  user: SideUser;
  demo: boolean;
  tasksDue?: number;
  teamName?: string | null;
  /** Sección actual (AppTopbar), se muestra en la banda. */
  crumb?: ReactNode;
}) {
  const t = useTranslations('common.sidebar');
  const pathname = usePathname();
  const product = appProductFromPath(pathname);
  // En la plataforma (Ajustes) no hay app activa: el shell va en tinta, sin color de producto.
  const app = SWITCHER_PRODUCTS.find((p) => p.key === product);
  const current = app ?? { name: labels.platform, line: null };

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Contador de tareas pedido de nuevo cuando la cookie tz recién se escribió
  // (el servidor lo contó con "hoy" en UTC). Ver TimezoneCookie.
  const [dueFresh, setDueFresh] = useState<{ from: number; count: number } | null>(null);
  useEffect(() => {
    function onTz() {
      fetch('/api/crm/tasks/due-count')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count?: unknown } | null) => {
          if (typeof d?.count === 'number') setDueFresh({ from: tasksDue, count: d.count });
        })
        .catch(() => {});
    }
    window.addEventListener(TZ_CHANGED_EVENT, onTz);
    return () => window.removeEventListener(TZ_CHANGED_EVENT, onTz);
  }, [tasksDue]);
  // Un valor nuevo del servidor (refresh, navegación dura) vuelve a mandar.
  const dueCount = dueFresh && dueFresh.from === tasksDue ? dueFresh.count : tasksDue;

  const asideRef = useRef<HTMLElement>(null);
  // Lista del sidebar con scroll propio: data-more-* encienden el fade de arriba/abajo (hay más ítems).
  const lineRef = useRef<HTMLElement>(null);
  const updateOverflow = useCallback(() => {
    const el = lineRef.current;
    if (!el) return;
    const above = el.scrollTop > 2;
    const below = el.scrollHeight - el.clientHeight - el.scrollTop > 2;
    if (above) el.setAttribute('data-more-above', '');
    else el.removeAttribute('data-more-above');
    if (below) el.setAttribute('data-more-below', '');
    else el.removeAttribute('data-more-below');
  }, []);
  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    updateOverflow();
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    // El árbol que cuelga en #side-branch (Docs, objetos) cambia el alto sin cambiar el de la lista.
    const mo = new MutationObserver(updateOverflow);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [updateOverflow]);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherBtn = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);

  const bellLabels = labels.notifications;

  const closeSwitcher = useCallback((focus = false) => {
    setSwitcherOpen(false);
    if (focus) switcherBtn.current?.focus();
  }, []);
  const closeNew = useCallback((focus = false) => {
    setNewOpen(false);
    if (focus) newBtn.current?.focus();
  }, []);

  // Clic afuera cierra los menús.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (switcherRef.current && !switcherRef.current.contains(target)) setSwitcherOpen(false);
      if (newRef.current && !newRef.current.contains(target)) setNewOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Al abrir un menú, el foco va al primer ítem (o al actual en el switcher).
  useEffect(() => {
    if (!switcherOpen) return;
    const el =
      switcherRef.current?.querySelector<HTMLElement>('[role="menuitem"][aria-current="page"]') ??
      switcherRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    el?.focus();
  }, [switcherOpen]);
  useEffect(() => {
    if (newOpen) newRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [newOpen]);

  // Navegar cierra drawer y menús.
  useEffect(() => {
    setDrawerOpen(false);
    setSwitcherOpen(false);
    setNewOpen(false);
  }, [pathname]);

  // Drawer: Esc lo cierra y devuelve el foco al botón de menú.
  useEffect(() => {
    if (!drawerOpen) return;
    asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuBtn.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Colapsado: persiste en localStorage; la clase vive en .app-frame (grid).
  const dense = denseRoute(pathname);
  useEffect(() => {
    const v = readCollapsed(dense);
    setCollapsed(v);
    asideRef.current?.closest('.app-frame')?.classList.toggle('sidebar-collapsed', v);
  }, [dense]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(dense, next);
    asideRef.current?.closest('.app-frame')?.classList.toggle('sidebar-collapsed', next);
  }

  const nav = buildNav(product, pathname, labels, { tasksDue: dueCount, unread: unreadCount });
  const newItems = buildNewItems(product, labels, { docsCanCreate });
  const settingsItem = settingsNavItem(pathname, labels);

  function openSearch() {
    window.dispatchEvent(new CustomEvent('zs:open-search'));
  }

  // Switcher: destacadas según el modo del workspace y el resto por categoría.
  const featured = featuredApps({ mode });
  const more = moreAppsByCategory({ mode });
  const switcherItem = (line: ProductKey, small = false) => {
    const key = appProductOf(line);
    return (
      <Link
        key={line}
        href={switcherHref(line)}
        role="menuitem"
        className={`band-menu-item${small ? ' band-menu-item-sm' : ''}`}
        onClick={() => setSwitcherOpen(false)}
        aria-current={key === product ? 'page' : undefined}
      >
        <ProductGlyph product={line} size={small ? 12 : 14} />
        <span>{PRODUCT_CONFIG[line].name}</span>
        {isBuildingProduct(line) && <span className="app-soon-tag">{labels.soon}</span>}
      </Link>
    );
  };

  return (
    <>
      {/* Color de la app activa (SSR, sin parpadeo). */}
      <style>
        {current.line
          ? `.app-frame{--accent:var(--c-${current.line});--accent-ink:var(--c-${current.line}-ink);--accent-on:var(--c-${current.line}-on)}`
          : '.app-frame{--accent:var(--ink);--accent-ink:var(--ink);--accent-on:var(--bg)}'}
      </style>

      {/*
        Primer foco de la página: salta el sidebar. Si la página marca un destino
        (data-skip-target, p. ej. el board de deals) va ahí y usa su etiqueta.
      */}
      <a
        href="#main"
        className="skip-link"
        onFocus={(e) => {
          const target = document.querySelector<HTMLElement>('[data-skip-target]');
          e.currentTarget.textContent = target?.dataset.skipLabel || t('skipToContent');
        }}
        onClick={(e) => {
          e.preventDefault();
          const target = document.querySelector<HTMLElement>('[data-skip-target]') ?? document.querySelector<HTMLElement>('.app-content');
          if (!target) return;
          const focusable = target.matches('[tabindex], a[href], button, input, select, textarea')
            ? target
            : target.querySelector<HTMLElement>('[tabindex="0"], a[href], button:not([disabled]), input, select, textarea');
          if (focusable) focusable.focus();
          else {
            target.tabIndex = -1;
            target.focus();
          }
        }}
      >
        {t('skipToContent')}
      </a>
      <header className="app-band">
        <button
          ref={menuBtn}
          type="button"
          className="band-btn band-menu"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label={drawerOpen ? t('closeMenu') : labels.menu}
          aria-expanded={drawerOpen}
          aria-controls="app-side"
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} size={18} />
        </button>

        <Link href="/app" className="band-home" aria-label={t('home')}>
          <Logo variant="symbol" tone="current" height={22} title="" />
        </Link>

        <div className="band-switcher" ref={switcherRef}>
          <button
            ref={switcherBtn}
            type="button"
            className="band-product"
            onClick={() => {
              setSwitcherOpen((v) => !v);
              setNewOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={switcherOpen}
            aria-label={`${current.name}. ${t('switchProduct')}`}
          >
            {/* En la plataforma no hay glifo: el logo de la banda ya es el cero. */}
            {current.line && <ProductGlyph product={current.line} size={14} className="band-product-glyph" />}
            <span className="band-product-name">{current.name}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          {switcherOpen && (
            <div
              className="band-menu-panel band-switcher-panel"
              role="menu"
              aria-label={t('switchProduct')}
              onKeyDown={(e) => menuKeys(e, () => closeSwitcher(true))}
            >
              <Link
                href="/app"
                role="menuitem"
                className="band-menu-item band-menu-home"
                onClick={() => setSwitcherOpen(false)}
                aria-current={pathname === '/app' ? 'page' : undefined}
              >
                <Icon name="overview" size={14} />
                <span>{labels.platformHome}</span>
              </Link>
              <p className="band-menu-section" aria-hidden="true">
                {labels.featured}
              </p>
              <div className="band-menu-featured" role="group" aria-label={labels.featured}>
                {featured.map((line) => switcherItem(line))}
              </div>
              {more.length > 0 && (
                <>
                  <p className="band-menu-section" aria-hidden="true">
                    {labels.moreApps}
                  </p>
                  <div className="band-menu-grid">
                    {more.map(({ category, apps }) => (
                      <div key={category} className="band-menu-cat" role="group" aria-label={labels.categories[category]}>
                        <p className="band-menu-cat-title" aria-hidden="true">
                          {labels.categories[category]}
                        </p>
                        {apps.map((line) => switcherItem(line, true))}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <button
                type="button"
                role="menuitem"
                className="band-menu-item band-menu-search"
                onClick={() => {
                  // El foco pasa al botón del switcher antes de abrir ⌘K: al cerrarlo con Esc vuelve ahí.
                  closeSwitcher(true);
                  openSearch();
                }}
              >
                <Icon name="search" size={14} />
                <span>{labels.search}</span>
                <kbd className="kbd">⌘K</kbd>
              </button>
            </div>
          )}
        </div>

        {crumb && <div className="band-crumb">{crumb}</div>}

        <div className="band-right">
          <button type="button" className="band-search" onClick={openSearch} aria-label={labels.search}>
            <Icon name="search" size={15} />
            <span className="band-search-label">{labels.search}</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          {product === 'crm' && (
            <button
              type="button"
              className="band-search band-ai"
              onClick={() => window.dispatchEvent(new CustomEvent('zs:crm-assistant'))}
              aria-label={labels.crm.askAi}
              aria-haspopup="dialog"
              data-crm-assistant-trigger
            >
              <Icon name="agents" size={15} />
              <span className="band-search-label">{labels.crm.askAi}</span>
            </button>
          )}
          {product === 'docs' && (
            <button
              type="button"
              className="band-search band-ai"
              onClick={() => window.dispatchEvent(new CustomEvent('zs:docs-ask'))}
              aria-label={labels.docs.askAi}
              aria-haspopup="dialog"
              data-docs-ask-trigger
            >
              <Icon name="agents" size={15} />
              <span className="band-search-label">{labels.docs.askAi}</span>
            </button>
          )}
          <NotificationBell labels={bellLabels} onCountChange={setUnreadCount} />
        </div>
      </header>

      {drawerOpen && <div className="side-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      <aside id="app-side" className={`side${drawerOpen ? ' open' : ''}`} ref={asideRef} aria-label={current.name}>
        <div className="side-new" ref={newRef}>
          <button
            ref={newBtn}
            type="button"
            className="btn btn-secondary btn-block side-new-btn"
            onClick={() => {
              setNewOpen((v) => !v);
              setSwitcherOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={newOpen}
            title={labels.new}
          >
            <Icon name="plus" size={15} />
            <span className="side-label">{labels.new}</span>
          </button>
          {newOpen && (
            <div className="side-menu" role="menu" onKeyDown={(e) => menuKeys(e, () => closeNew(true))}>
              {newItems.length === 0 && <p className="side-menu-note">{t('newReadOnly')}</p>}
              {newItems.map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  role="menuitem"
                  className="side-menu-item"
                  onClick={() => setNewOpen(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <nav className={`side-line${product === 'home' ? ' side-line-compact' : ''}`} aria-label={current.name} ref={lineRef} onScroll={updateOverflow}>
          {nav.map((group, i) => (
            <div key={group.section ?? `top-${i}`} className="side-group">
              {group.section && <p className="side-section">{group.section}</p>}
              {group.items.map((item) => (
                <Fragment key={item.href}>
                  <Link
                    href={item.href}
                    // En la plataforma el sidebar lista todas las apps: sin prefetch, que cada una es una página dinámica.
                    prefetch={product === 'home' ? false : undefined}
                    className={`side-stop${item.active ? ' active' : ''}`}
                    aria-current={item.active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="side-icon" aria-hidden="true">
                      <Icon name={item.icon} size={15} />
                    </span>
                    <span className="side-label">{item.label}</span>
                    {item.soon && <span className="app-soon-tag side-soon">{labels.soon}</span>}
                    {item.badge ? <span className="side-badge data">{item.badge}</span> : null}
                  </Link>
                  {/* Hueco bajo el ítem: la página del producto lo llena con un portal (el árbol de Docs). */}
                  {item.branch && <div id="side-branch" className="side-branch" />}
                </Fragment>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <Link
            href={settingsItem.href}
            className={`side-link${settingsItem.active ? ' active' : ''}`}
            aria-current={settingsItem.active ? 'page' : undefined}
            title={collapsed ? settingsItem.label : undefined}
            data-testid="side-settings"
          >
            <Icon name={settingsItem.icon} size={15} />
            <span className="side-label">{settingsItem.label}</span>
          </Link>
          <Link href="/docs" className="side-link" title={collapsed ? labels.docsSite : undefined} data-testid="side-help">
            <Icon name="help" size={15} />
            <span className="side-label">{labels.docsSite}</span>
          </Link>
          <Link href="/" className="side-link" title={collapsed ? labels.backToSite : undefined}>
            <Icon name="back" size={15} />
            <span className="side-label">{labels.backToSite}</span>
          </Link>
          <ThemeSwitcher className="side-theme" />
          <div className="side-user">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="side-avatar" aria-hidden="true">
                {(user.name ?? user.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            {/* Con un equipo activo, el equipo va en lugar del mail (que queda en el title):
                arriba de la lista empujaba las últimas apps bajo el pliegue. */}
            <div className="side-user-meta side-label" title={teamName ? `${user.email} · ${labels.team}: ${teamName}` : undefined}>
              <p className="side-user-name">{user.name ?? user.email}</p>
              {teamName ? (
                <p className="side-user-mail side-team" data-testid="side-team">
                  {labels.team}: {teamName}
                </p>
              ) : (
                <p className="side-user-mail">{user.email}</p>
              )}
            </div>
            {demo ? (
              <Link href="/" className="side-signout side-label">
                {labels.signOut}
              </Link>
            ) : (
              <button
                type="button"
                className="side-signout side-label"
                onClick={() => void clearOfflineData().finally(() => signOut({ callbackUrl: '/' }))}
              >
                {labels.signOut}
              </button>
            )}
          </div>
          <button
            type="button"
            className="side-handle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? labels.expand : labels.collapse}
            aria-pressed={collapsed}
            title={collapsed ? labels.expand : labels.collapse}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 3v10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className="side-label">{collapsed ? labels.expand : labels.collapse}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
