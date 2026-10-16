'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { signOut } from 'next-auth/react';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from './icons';
import { appProductFromPath, buildNav, buildNewItems, settingsNavItem, type SidebarLabels } from './sidebar-nav';
import NotificationBell from './NotificationBell';
import FeedbackButton from './FeedbackButton';

export type { SidebarLabels };

interface SideUser {
  name: string | null;
  email: string;
  image: string | null;
}

const PRODUCTS = [
  { key: 'link', name: 'Link', href: '/app' },
  { key: 'crm', name: 'CRM', href: '/app/crm' },
  { key: 'docs', name: 'Docs', href: '/app/docs' },
  { key: 'calendar', name: 'Cal', href: '/app/calendar' },
  { key: 'track', name: 'Track', href: '/app/track' },
  { key: 'chat', name: 'Chat', href: '/app/chat' },
  { key: 'flow', name: 'Flow', href: '/app/flow' },
  { key: 'notes', name: 'Notes', href: '/app/notes' },
  { key: 'board', name: 'Board', href: '/app/board' },
  { key: 'agents', name: 'Agents', href: '/app/agents' },
  { key: 'robots', name: 'Robots', href: '/app/robots' },
] as const;

/** Color de cada producto (tokens --c-* de globals.css). */
const PRODUCT_COLOR: Record<string, string> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  docs: 'var(--c-docs)',
  calendar: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  flow: 'var(--c-flow)',
  notes: 'var(--c-notes)',
  board: 'var(--c-board)',
  agents: 'var(--c-agents)',
  robots: 'var(--c-robots)',
};

/**
 * Chrome de las apps: sidebar por producto estilo Twenty (switcher, búsqueda,
 * secciones agrupadas, quick actions, usuario abajo). Reemplaza al AppShell
 * de tabs. En <1024px colapsa a topbar + drawer.
 */
export default function AppSidebar({
  labels,
  user,
  demo,
  tasksDue = 0,
  teamName = null,
}: {
  labels: SidebarLabels;
  user: SideUser;
  demo: boolean;
  tasksDue?: number;
  teamName?: string | null;
}) {
  const pathname = usePathname();
  const product = appProductFromPath(pathname);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const bellLabels = {
    title: labels.notifications.title,
    markRead: labels.notifications.markRead,
    markAllRead: labels.notifications.markAllRead,
    empty: labels.notifications.empty,
  };

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
        setNewOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Cierra el drawer al navegar.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Una sola campana (un solo polling): en el sidebar en desktop y en la
  // topbar en mobile (<1024px), donde el sidebar es un drawer oculto.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Sidebar colapsable (solo desktop ≥1024px; persiste en localStorage).
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const v = window.localStorage.getItem('zs-side-collapsed') === '1';
    setCollapsed(v);
    rootRef.current
      ?.closest('.app-frame')
      ?.classList.toggle('sidebar-collapsed', v);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('zs-side-collapsed', next ? '1' : '0');
      rootRef.current
        ?.closest('.app-frame')
        ?.classList.toggle('sidebar-collapsed', next);
      return next;
    });
  }

  const nav = buildNav(product, pathname, labels, { tasksDue, unread: unreadCount });
  const newItems = buildNewItems(product, labels);
  const settingsItem = settingsNavItem(pathname, labels);

  const current = PRODUCTS.find((p) => p.key === product) ?? PRODUCTS[0];

  function openSearch() {
    window.dispatchEvent(new CustomEvent('zs:open-search'));
  }

  const aside = (
    <aside className={`side${drawerOpen ? ' open' : ''}`} ref={rootRef}>
      <div className="side-head-row">
        <div className="side-switcher" style={{ flex: 1 }}>
          <button
            type="button"
            className="side-product"
            onClick={() => {
              setSwitcherOpen((v) => !v);
              setNewOpen(false);
            }}
            aria-expanded={switcherOpen}
          >
            <span>{current.name}</span>
            <span className="caret">▾</span>
          </button>
          {switcherOpen && (
            <div className="side-menu" role="menu">
              {PRODUCTS.map((p) => (
                <Link
                  key={p.key}
                  href={p.href}
                  onClick={() => setSwitcherOpen(false)}
                  data-product={p.key}
                  style={{ '--dot': PRODUCT_COLOR[p.key] } as CSSProperties}
                  aria-current={p.key === product ? 'true' : undefined}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        {!isMobile && <NotificationBell labels={bellLabels} onCountChange={setUnreadCount} />}
        <button type="button" className="side-close" onClick={() => setDrawerOpen(false)}>
          ✕
        </button>
      </div>

      <button type="button" className="side-search" onClick={openSearch}>
        <span>{labels.search}</span>
        <kbd>⌘K</kbd>
      </button>

      {teamName && (
        <p className="side-team mono" title={`${labels.team}: ${teamName}`}>
          {labels.team}: {teamName}
        </p>
      )}

      <div className="side-new">
        <button
          type="button"
          className="side-new-btn"
          onClick={() => {
            setNewOpen((v) => !v);
            setSwitcherOpen(false);
          }}
          aria-expanded={newOpen}
        >
          <span>{labels.new}</span>
          <span>＋</span>
        </button>
        {newOpen && (
          <div className="side-menu" role="menu">
            {newItems.map((item) => (
              <Link key={item.href + item.label} href={item.href} onClick={() => setNewOpen(false)}>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <nav className="side-nav">
        {nav.map((group, i) => (
          <div key={group.section ?? `top-${i}`}>
            {group.section && <p className="side-section">{group.section}</p>}
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`side-link${item.active ? ' active' : ''}`}
                aria-current={item.active ? 'page' : undefined}
                title={item.label}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge ? <span className="side-badge mono">{item.badge}</span> : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <Link
          href={settingsItem.href}
          className={`side-link${settingsItem.active ? ' active' : ''}`}
          aria-current={settingsItem.active ? 'page' : undefined}
          title={settingsItem.label}
          data-testid="side-settings"
        >
          <Icon name={settingsItem.icon} />
          {settingsItem.label}
        </Link>
        <Link href="/" className="side-link" title={labels.backToSite}>
          <Icon name="back" />
          {labels.backToSite}
        </Link>
        <Link href="/docs" className="side-link" title={labels.docsSite}>
          <Icon name="docs" />
          {labels.docsSite}
        </Link>
        <FeedbackButton email={user.email} />
        <div className="side-user">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="side-avatar">0</span>
          )}
          <div className="side-user-meta">
            <p className="side-user-name">{user.name ?? user.email}</p>
            <p className="side-user-mail">{user.email}</p>
          </div>
        </div>
        {demo ? (
          <Link href="/" className="side-signout">
            {labels.signOut}
          </Link>
        ) : (
          <button type="button" className="side-signout" onClick={() => signOut({ callbackUrl: '/' })}>
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
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );

  return (
    <>
      {/* Color del producto activo (SSR, sin parpadeo). */}
      <style>{`.app-frame{--accent:${PRODUCT_COLOR[product] ?? 'var(--ink)'}}`}</style>
      <div className="app-topbar">
        <div className="app-topbar-left">
          <button type="button" className="side-close" onClick={() => setDrawerOpen(true)} aria-label={labels.menu}>
            ☰
          </button>
          <span className="brand-zero" aria-hidden="true">0</span>
        </div>
        <button type="button" className="side-product" onClick={() => setDrawerOpen(true)}>
          <span>{current.name}</span>
          <span className="caret">▾</span>
        </button>
        <div className="app-topbar-right">
          {isMobile && <NotificationBell labels={bellLabels} onCountChange={setUnreadCount} />}
          <button type="button" className="side-close" onClick={openSearch} aria-label={labels.search}>
            ⌘K
          </button>
        </div>
      </div>
      {drawerOpen && <div className="side-backdrop" onClick={() => setDrawerOpen(false)} />}
      {aside}
    </>
  );
}
