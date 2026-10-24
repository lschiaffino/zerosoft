'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { TZ_CHANGED_EVENT } from '@/lib/tz-client';
import { collapsedFrom, denseRoute, storageKey } from '@/lib/sidebar-collapsed';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from './icons';
import {
  appProductFromPath,
  buildNav,
  buildNewItems,
  settingsNavItem,
  type AppProduct,
  type SidebarLabels,
} from './sidebar-nav';
import NotificationBell from './NotificationBell';
import Logo from '@/components/brand/Logo';
import ProductGlyph from '@/components/brand/ProductGlyph';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import type { ProductKey } from '@/lib/products';

export type { SidebarLabels };

interface SideUser {
  name: string | null;
  email: string;
  image: string | null;
}

/** Las once apps en el orden del switcher. `line` es la clave de color (Cal = cal). */
const PRODUCTS: ReadonlyArray<{ key: AppProduct; line: ProductKey; name: string; href: string }> = [
  { key: 'link', line: 'link', name: 'Link', href: '/app' },
  { key: 'crm', line: 'crm', name: 'CRM', href: '/app/crm' },
  { key: 'docs', line: 'docs', name: 'Docs', href: '/app/docs' },
  { key: 'calendar', line: 'cal', name: 'Cal', href: '/app/calendar' },
  { key: 'track', line: 'track', name: 'Track', href: '/app/track' },
  { key: 'chat', line: 'chat', name: 'Chat', href: '/app/chat' },
  { key: 'groups', line: 'groups', name: 'Groups', href: '/app/groups' },
  { key: 'flow', line: 'flow', name: 'Flow', href: '/app/flow' },
  { key: 'notes', line: 'notes', name: 'Notes', href: '/app/notes' },
  { key: 'board', line: 'board', name: 'Board', href: '/app/board' },
  { key: 'agents', line: 'agents', name: 'Agents', href: '/app/agents' },
  { key: 'robots', line: 'robots', name: 'Robots', href: '/app/robots' },
];

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
}: {
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
  const current = PRODUCTS.find((p) => p.key === product) ?? PRODUCTS[0];

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
  const newItems = buildNewItems(product, labels);
  const settingsItem = settingsNavItem(pathname, labels);

  function openSearch() {
    window.dispatchEvent(new CustomEvent('zs:open-search'));
  }

  return (
    <>
      {/* Color de la app activa (SSR, sin parpadeo). */}
      <style>{`.app-frame{--accent:var(--c-${current.line});--accent-ink:var(--c-${current.line}-ink);--accent-on:var(--c-${current.line}-on)}`}</style>

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
            <ProductGlyph product={current.line} size={14} className="band-product-glyph" />
            <span className="band-product-name">{current.name}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          {switcherOpen && (
            <div
              className="band-menu-panel"
              role="menu"
              aria-label={t('switchProduct')}
              onKeyDown={(e) => menuKeys(e, () => closeSwitcher(true))}
            >
              {PRODUCTS.map((p) => (
                <Link
                  key={p.key}
                  href={p.href}
                  role="menuitem"
                  className="band-menu-item"
                  onClick={() => setSwitcherOpen(false)}
                  aria-current={p.key === product ? 'page' : undefined}
                >
                  <ProductGlyph product={p.line} size={14} />
                  <span>{p.name}</span>
                </Link>
              ))}
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

        {teamName && (
          <p className="side-team" title={`${labels.team}: ${teamName}`}>
            <span className="side-label">
              {labels.team}: {teamName}
            </span>
          </p>
        )}

        <nav className="side-line" aria-label={current.name}>
          {nav.map((group, i) => (
            <div key={group.section ?? `top-${i}`} className="side-group">
              {group.section && <p className="side-section">{group.section}</p>}
              {group.items.map((item) => (
                <Fragment key={item.href}>
                  <Link
                    href={item.href}
                    className={`side-stop${item.active ? ' active' : ''}`}
                    aria-current={item.active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="side-icon" aria-hidden="true">
                      <Icon name={item.icon} size={15} />
                    </span>
                    <span className="side-label">{item.label}</span>
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
          <Link href="/docs" className="side-link" title={collapsed ? labels.docsSite : undefined}>
            <Icon name="docs" size={15} />
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
            <div className="side-user-meta side-label">
              <p className="side-user-name">{user.name ?? user.email}</p>
              <p className="side-user-mail">{user.email}</p>
            </div>
            {demo ? (
              <Link href="/" className="side-signout side-label">
                {labels.signOut}
              </Link>
            ) : (
              <button type="button" className="side-signout side-label" onClick={() => signOut({ callbackUrl: '/' })}>
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
