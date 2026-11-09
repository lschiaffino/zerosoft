'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';
import { clearOfflineData } from '@/lib/offline-queue';
import RecSignOutDialog from '@/components/rec/RecSignOutDialog';
import NotesSignOutDialog from '@/components/notes/NotesSignOutDialog';
import OfflineStatus from './OfflineStatus';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { pendingWrites } from '@/lib/offline-fetch';
import { useTranslations } from 'next-intl';
import { TZ_CHANGED_EVENT } from '@/lib/tz-client';
import { desktopBridge, type DesktopBridge } from '@/lib/desktop-bridge';
import { collapsedFrom, denseRoute, storageKey } from '@/lib/sidebar-collapsed';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from './icons';
import {
  appProductFromPath,
  appProductOf,
  buildNav,
  buildNewItems,
  comingSoonHref,
  settingsNavItem,
  importNavItem,
  productKeyOf,
  switcherHref,
  SWITCHER_PRODUCTS,
  type SidebarLabels,
} from './sidebar-nav';
import { APP_SWITCHER_ORDER, PRODUCT_CONFIG, appAllowed, isComingSoon, type ProductKey } from '@/lib/products';
import { DEFAULT_WORKSPACE_MODE, featuredApps, moreAppsByCategory, type WorkspaceMode } from '@/lib/workspace-mode';
import NotificationBell from './NotificationBell';
import WorkspaceSwitcher, { type SwitcherEntry } from './WorkspaceSwitcher';
import Logo from '@/components/brand/Logo';
import ProductGlyph from '@/components/brand/ProductGlyph';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { useLayer } from '@/lib/ui/layers';

export type { SidebarLabels };

interface SideUser {
  name: string | null;
  email: string;
  image: string | null;
  /** Persona real y workspace (para sus datos guardados en este navegador). */
  id?: string;
  ws?: string;
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
  else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // En la grilla del switcher, ←/→ van a la columna de al lado (el más cercano en altura); en una lista, siguiente/anterior.
    const side = sideItem(items, i, e.key === 'ArrowRight' ? 1 : -1);
    go(side ?? (i < 0 ? 0 : i + (e.key === 'ArrowRight' ? 1 : -1)));
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
  workspaces = [],
  allowedApps = '*',
  crumb = null,
  mode = DEFAULT_WORKSPACE_MODE,
  docsCanCreate = true,
  staff = false,
}: {
  /** Staff de zerosoft (ADMIN_EMAILS): abre las apps "Próximamente" como vista previa. */
  staff?: boolean;
  /** Puede crear páginas de Docs de primer nivel (si no, el "+ Nuevo" no las ofrece). */
  docsCanCreate?: boolean;
  /** Modo del workspace: ordena el switcher (destacadas y "Más apps"). */
  mode?: WorkspaceMode;
  labels: SidebarLabels;
  user: SideUser;
  demo: boolean;
  tasksDue?: number;
  teamName?: string | null;
  /** Workspaces de la persona (el propio y los ajenos), para el switcher de arriba del sidebar. */
  workspaces?: SwitcherEntry[];
  /** Apps que la persona tiene en el workspace activo ('*' = todas): las demás no se listan. */
  allowedApps?: '*' | ProductKey[];
  /** Sección actual (AppTopbar), se muestra en la banda. */
  crumb?: ReactNode;
}) {
  const t = useTranslations('common.sidebar');
  // Dentro de la app de escritorio: sus Ajustes (dictado, permisos, indicador) en el menú de la cuenta.
  const [desktop, setDesktop] = useState<DesktopBridge | null>(null);
  useEffect(() => setDesktop(desktopBridge()), []);
  const pathname = usePathname();
  const product = appProductFromPath(pathname);
  // En la plataforma (Ajustes) no hay app activa: el shell va en tinta, sin color de producto.
  const app = SWITCHER_PRODUCTS.find((p) => p.key === product);
  const current = app ?? { name: labels.platform, line: null };

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Cerrar sesión: si quedaron grabaciones de Rec sin subir en este navegador, primero se avisa.
  const recOwner = user.id && user.ws ? { userId: user.id, ws: user.ws } : null;
  const [recPending, setRecPending] = useState(0);
  // Notes: cambios sin subir (o sin red) se avisan antes de borrar la copia del dispositivo.
  const [notesWarn, setNotesWarn] = useState<{ count: number; offline: boolean; text: string } | null>(null);
  // Cambios de CRM y Track en la cola del service worker: al salir se borran, así que primero se avisa.
  const [queueWarn, setQueueWarn] = useState(0);
  const tOffline = useTranslations('common.offline');
  const doSignOut = () => void clearOfflineData(recOwner ?? undefined).finally(() => signOut({ callbackUrl: '/' }));
  async function requestSignOut(opts: { skipQueue?: boolean } = {}) {
    if (recOwner && !opts.skipQueue) {
      const queued = await pendingWrites(`${recOwner.userId}:${recOwner.ws}`, () => true, { failed: true }).catch(() => []);
      if (queued.length) {
        setQueueWarn(queued.length);
        return;
      }
    }
    if (recOwner) {
      const { pendingFor } = await import('@/components/rec/recStore');
      const pending = await pendingFor(recOwner.userId, recOwner.ws).catch(() => []);
      if (pending.length) {
        setRecPending(pending.length);
        return;
      }
      const { pendingNotesChanges, pendingAsText } = await import('@/components/notes/notesOffline');
      const notes = await pendingNotesChanges(recOwner).catch(() => ({ ops: [], stuck: [], files: 0 }));
      const count = notes.ops.length + notes.stuck.length + notes.files;
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (count || offline) {
        setNotesWarn({ count, offline, text: pendingAsText(notes) });
        return;
      }
    }
    doSignOut();
  }
  // Apps usadas hace poco (las primeras del sidebar del inicio): solo en este navegador.
  const [recentApps, setRecentApps] = useState<string[]>([]);
  useEffect(() => {
    try {
      // Por persona y workspace: en un navegador compartido cada uno tiene su orden.
      const storeKey = `zs:recent-apps:${user.id}:${user.ws}`;
      const list = JSON.parse(window.localStorage.getItem(storeKey) ?? '[]') as unknown;
      const prev = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
      const key = productKeyOf(product);
      const next = key ? [key, ...prev.filter((x) => x !== key)].slice(0, 8) : prev;
      if (key) window.localStorage.setItem(storeKey, JSON.stringify(next));
      setRecentApps(next);
    } catch {
      // Sin storage: las destacadas del modo.
    }
  }, [product, user.id, user.ws]);
  // Grupos plegables abiertos o cerrados a mano (por producto y sección).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('zs:side-groups');
      if (raw) setOpenGroups(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // Sin storage: plegados por defecto.
    }
  }, []);
  const toggleGroup = useCallback((key: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: open };
      try {
        window.localStorage.setItem('zs:side-groups', JSON.stringify(next));
      } catch {
        // Solo comodidad.
      }
      return next;
    });
  }, []);
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
  const switcherByKeyboard = useRef(false);
  const newRef = useRef<HTMLDivElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const switcherPanel = useRef<HTMLDivElement>(null);
  const newPanel = useRef<HTMLDivElement>(null);
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

  // Capas (lib/ui/layers.ts): abrir uno cierra cualquier otro menú de la app (la cuenta, la campana, los de la página),
  // clic afuera y Esc cierran, y el panel se acomoda dentro de la pantalla.
  useLayer(switcherOpen, () => setSwitcherOpen(false), { root: switcherRef, trigger: switcherBtn, panel: switcherPanel });
  useLayer(newOpen, () => setNewOpen(false), { root: newRef, trigger: newBtn, panel: newPanel });

  // Al abrir un menú, el foco va al primer ítem. En el switcher va al actual si se abrió con teclado;
  // con el mouse queda en el panel, para que las flechas funcionen sin pintar un anillo que nadie pidió.
  useEffect(() => {
    if (!switcherOpen) return;
    const el = !switcherByKeyboard.current ? switcherRef.current?.querySelector<HTMLElement>('.band-switcher-panel') :
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

  // Drawer (teléfono): es una capa más. Abrir el switcher o ⌘K lo cierra, y Esc lo cierra (devolviendo el foco al
  // botón de menú) solo si no hay otra capa arriba: con el menú de la cuenta abierto, Esc cierra ese menú.
  useLayer(drawerOpen, () => setDrawerOpen(false), { root: asideRef, trigger: menuBtn });
  useEffect(() => {
    if (drawerOpen) asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
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

  const nav = buildNav(product, pathname, labels, { tasksDue: dueCount, unread: unreadCount, allowed: allowedApps, recentApps, mode, staff });
  const newItems = buildNewItems(product, labels, { docsCanCreate, pathname });
  const settingsItem = settingsNavItem(pathname, labels);
  const importItem = importNavItem(product, labels);

  function openSearch() {
    window.dispatchEvent(new CustomEvent('zs:open-search'));
  }

  // Switcher: destacadas según el modo del workspace y el resto por categoría.
  const allowed = (k: ProductKey) => appAllowed(allowedApps, k);
  // "Próximamente" al pie del switcher (lista de espera); el staff las ve entre las demás, como vista previa.
  const soonApps = APP_SWITCHER_ORDER.filter((k) => isComingSoon(k) && !(staff && allowed(k)));
  const featured = featuredApps({ mode }).filter(allowed);
  const more = moreAppsByCategory({ mode })
    .map((g) => ({ ...g, apps: g.apps.filter(allowed) }))
    .filter((g) => g.apps.length > 0);
  const switcherItem = (line: ProductKey) => {
    const key = appProductOf(line);
    return (
      <Link
        key={line}
        href={switcherHref(line)}
        role="menuitem"
        className="band-menu-item"
        onClick={() => setSwitcherOpen(false)}
        aria-current={key === product ? 'page' : undefined}
      >
        <ProductGlyph product={line} size={14} />
        <span>{PRODUCT_CONFIG[line].name}</span>
        {isComingSoon(line) && <span className="app-soon-tag">{labels.preview ?? labels.soon}</span>}
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
            onClick={(e) => {
              switcherByKeyboard.current = e.detail === 0;
              setSwitcherOpen((v) => !v);
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
              ref={switcherPanel}
              className="band-menu-panel band-switcher-panel"
              role="menu"
              tabIndex={-1}
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
                {featured.map(switcherItem)}
              </div>
              {more.length > 0 && (
                <div className="band-menu-grid" role="group" aria-label={labels.moreApps}>
                  {more.map(({ category, apps }) => (
                    <div key={category} className="band-menu-cat" role="group" aria-label={labels.categories[category]}>
                      <p className="band-menu-cat-title" aria-hidden="true">
                        {labels.categories[category]}
                      </p>
                      {apps.map(switcherItem)}
                    </div>
                  ))}
                </div>
              )}
              {soonApps.length > 0 && (
                <div className="band-menu-soon" role="group" aria-label={labels.comingSoon ?? labels.soon}>
                  <p className="band-menu-cat-title" aria-hidden="true">
                    {labels.comingSoon ?? labels.soon}
                  </p>
                  <div className="band-menu-soon-list">
                    {soonApps.map((line) => (
                      <Link
                        key={line}
                        href={comingSoonHref(line)}
                        role="menuitem"
                        className="band-menu-item band-menu-soon-item"
                        onClick={() => setSwitcherOpen(false)}
                        data-testid={`switcher-soon-${line}`}
                      >
                        <ProductGlyph product={line} size={14} />
                        <span>{PRODUCT_CONFIG[line].name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
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
          {/* Indicador de Voice cuando hay una reunión grabando (lo llena components/voice/RecorderProvider). */}
          <span id="band-voice-slot" className="band-voice-slot" />
          {/* Sin conexión: estado, cambios en el dispositivo y los que no se guardaron (components/app/OfflineStatus). */}
          {user.id && user.ws && <OfflineStatus owner={`${user.id}:${user.ws}`} />}
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
          {/* Asistente de la plataforma (panel lateral en toda la app, ⌘J). */}
          <button
            type="button"
            className="band-search band-ai band-assistant"
            onClick={() => window.dispatchEvent(new CustomEvent('zs:assistant'))}
            aria-label={t('assistant')}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+J Control+J"
            title={`${t('assistant')} (⌘J)`}
            data-assistant-trigger
          >
            <Icon name="assistant" size={15} />
            <span className="band-search-label">{t('assistant')}</span>
            <kbd className="kbd">⌘J</kbd>
          </button>
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
            }}
            aria-haspopup="menu"
            aria-expanded={newOpen}
            title={labels.new}
          >
            <Icon name="plus" size={15} />
            <span className="side-label">{labels.new}</span>
          </button>
          {newOpen && (
            <div ref={newPanel} className="side-menu" role="menu" onKeyDown={(e) => menuKeys(e, () => closeNew(true))}>
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

        <nav className="side-line" aria-label={current.name} ref={lineRef} onScroll={updateOverflow}>
          {nav.map((group, i) => {
            const key = group.section ?? `top-${i}`;
            // Grupo plegable ("More"): abierto si la persona lo abrió o si tiene el ítem activo.
            const folded = Boolean(group.collapsible) && !(openGroups[`${product}:${key}`] ?? group.items.some((it) => it.active));
            return (
            <div key={key} className="side-group">
              {group.section &&
                (group.collapsible ? (
                  <button
                    type="button"
                    className="side-section side-section-toggle"
                    aria-expanded={!folded}
                    onClick={() => toggleGroup(`${product}:${key}`, folded)}
                    data-testid="side-section-toggle"
                  >
                    <span>{group.section}</span>
                    <span className={`side-section-chevron${folded ? '' : ' open'}`} aria-hidden="true">
                      <Icon name="chevronRight" size={11} />
                    </span>
                  </button>
                ) : (
                  <p className="side-section">{group.section}</p>
                ))}
              {!folded && group.items.map((item) =>
                item.branchOnly ? (
                  <Fragment key={item.href}>{item.branch && <div id="side-branch" className="side-branch" />}</Fragment>
                ) : (
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
                    {item.soon === 'preview' && <span className="app-soon-tag side-soon">{labels.preview ?? labels.soon}</span>}
                    {item.badge ? <span className="side-badge data">{item.badge}</span> : null}
                  </Link>
                  {/* Hueco bajo el ítem: la página del producto lo llena con un portal (el árbol de Docs). */}
                  {item.branch && <div id="side-branch" className="side-branch" />}
                </Fragment>
                ),
              )}
            </div>
            );
          })}
        </nav>

        <div className="side-foot">
          {/* Una sola fila, como Linear o Notion: lo demás vive en el menú de la cuenta. */}
          <div className="side-user">
            <WorkspaceSwitcher
              entries={workspaces}
              collapsed={collapsed}
              person={user.name ?? user.email}
              email={user.email}
              avatar={
                user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="side-avatar" aria-hidden="true">
                    {(user.name ?? user.email).slice(0, 1).toUpperCase()}
                  </span>
                )
              }
            >
              <Link
                href={settingsItem.href}
                role="menuitem"
                className="side-menu-item"
                aria-current={settingsItem.active ? 'page' : undefined}
                data-testid="side-settings"
              >
                <Icon name={settingsItem.icon} size={14} />
                {settingsItem.label}
              </Link>
              {desktop && (
                <button type="button" role="menuitem" className="side-menu-item ws-switcher-item" onClick={() => desktop.openSettings()} data-testid="side-desktop-settings">
                  <Icon name={settingsItem.icon} size={14} />
                  {t('desktopSettings')}
                </button>
              )}
              {importItem && (
                <Link
                  href={importItem.href}
                  role="menuitem"
                  className="side-menu-item"
                  aria-current={importItem.active ? 'page' : undefined}
                  data-testid="side-import"
                >
                  <Icon name={importItem.icon} size={14} />
                  {importItem.label}
                </Link>
              )}
              <Link href="/docs" role="menuitem" className="side-menu-item" data-testid="side-help">
                <Icon name="help" size={14} />
                {labels.docsSite}
              </Link>
              <Link href="/" role="menuitem" className="side-menu-item">
                <Icon name="back" size={14} />
                {labels.backToSite}
              </Link>
              <ThemeSwitcher className="side-theme" />
              <div className="ws-switcher-sep" role="separator" />
              {demo ? (
                <Link href="/" role="menuitem" className="side-menu-item" data-testid="side-signout">
                  {labels.signOut}
                </Link>
              ) : (
                <button type="button" role="menuitem" className="side-menu-item ws-switcher-item" onClick={() => void requestSignOut()} data-testid="side-signout">
                  {labels.signOut}
                </button>
              )}
            </WorkspaceSwitcher>
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
            </button>
          </div>
          {/* Fuera del menú: siguen abiertos aunque el menú ya se haya cerrado. */}
          {!demo && (
            <>
              <ConfirmDialog
                open={queueWarn > 0}
                title={tOffline('signOutTitle', { count: queueWarn })}
                body={<p>{tOffline('signOutBody')}</p>}
                confirmLabel={tOffline('signOutConfirm')}
                cancelLabel={tOffline('signOutCancel')}
                danger
                onConfirm={() => {
                  setQueueWarn(0);
                  void requestSignOut({ skipQueue: true });
                }}
                onCancel={() => setQueueWarn(0)}
              />
              <RecSignOutDialog open={recPending > 0} count={recPending} owner={recOwner} onClose={() => setRecPending(0)} onSignOut={doSignOut} />
              <NotesSignOutDialog
                open={notesWarn !== null}
                count={notesWarn?.count ?? 0}
                offline={notesWarn?.offline ?? false}
                text={notesWarn?.text ?? ''}
                onClose={() => setNotesWarn(null)}
                onSignOut={() => {
                  setNotesWarn(null);
                  doSignOut();
                }}
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
