'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { signOut } from 'next-auth/react';
import { Link, usePathname } from '@/i18n/navigation';
import Icon, { type IconName } from './icons';
import NotificationBell from './NotificationBell';
import FeedbackButton from './FeedbackButton';

export interface SidebarLabels {
  search: string;
  new: string;
  backToSite: string;
  docsSite: string;
  soon: string;
  signOut: string;
  records: string;
  activity: string;
  insights: string;
  linksSection: string;
  workspace: string;
  newContact: string;
  newCompany: string;
  newDeal: string;
  newTask: string;
  newLink: string;
  newDocPage: string;
  newEventType: string;
  newProject: string;
  newWidget: string;
  newFlow: string;
  newAgent: string;
  newRobot: string;
  team: string;
  link: { overview: string; links: string; new: string; bio: string; settings: string };
  crm: {
    overview: string;
    contacts: string;
    companies: string;
    deals: string;
    tasks: string;
    lists: string;
    reports: string;
    dashboards: string;
    workflows: string;
    settings: string;
    sequences: string;
    templates: string;
    products: string;
    quotes: string;
    forms: string;
  };
  docs: {
    overview: string;
    pages: string;
    new: string;
  };
  calendar: {
    overview: string;
    eventTypes: string;
    bookings: string;
    routing: string;
    availability: string;
    settings: string;
  };
  track: {
    overview: string;
    myTasks: string;
    projects: string;
    issues: string;
    cycles: string;
    settings: string;
    inbox: string;
  };
  chat: {
    overview: string;
    inbox: string;
    people: string;
    reports: string;
    settings: string;
  };
  flow: {
    flows: string;
  };
  /** Notes y Board (opcionales: los aporta su propio namespace de mensajes). */
  notes?: { all: string; newNote: string };
  board?: { boards: string; newBoard: string };
  agents: {
    agents: string;
  };
  robots: {
    robots: string;
  };
  notifications: {
    title: string;
    markRead: string;
    markAllRead: string;
    empty: string;
  };
}

interface SideUser {
  name: string | null;
  email: string;
  image: string | null;
}

interface Item {
  href: string;
  label: string;
  active: boolean;
  icon: IconName;
  badge?: number;
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
  const product = pathname.includes('/app/crm')
    ? 'crm'
    : pathname.includes('/app/docs')
      ? 'docs'
      : pathname.includes('/app/calendar')
        ? 'calendar'
        : pathname.includes('/app/track')
          ? 'track'
          : pathname.includes('/app/chat')
            ? 'chat'
            : pathname.includes('/app/flow')
              ? 'flow'
              : pathname.includes('/app/notes')
                ? 'notes'
                : pathname.includes('/app/board')
                  ? 'board'
                  : pathname.includes('/app/agents')
                    ? 'agents'
                    : pathname.includes('/app/robots')
                      ? 'robots'
                      : 'link';
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

  const crmNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/crm', label: labels.crm.overview, active: pathname === '/app/crm', icon: 'overview' }] },
    {
      section: labels.records,
      items: [
        { href: '/app/crm/contacts', label: labels.crm.contacts, active: pathname.startsWith('/app/crm/contacts'), icon: 'contacts' },
        { href: '/app/crm/companies', label: labels.crm.companies, active: pathname.startsWith('/app/crm/companies'), icon: 'companies' },
        { href: '/app/crm/deals', label: labels.crm.deals, active: pathname.startsWith('/app/crm/deals'), icon: 'deals' },
        { href: '/app/crm/lists', label: labels.crm.lists, active: pathname.startsWith('/app/crm/lists'), icon: 'lists' },
        { href: '/app/crm/products', label: labels.crm.products, active: pathname.startsWith('/app/crm/products'), icon: 'lists' },
        { href: '/app/crm/quotes', label: labels.crm.quotes, active: pathname.startsWith('/app/crm/quotes'), icon: 'docs' },
      ],
    },
    {
      section: labels.activity,
      items: [
        {
          href: '/app/crm/tasks',
          label: labels.crm.tasks,
          active: pathname.startsWith('/app/crm/tasks'),
          icon: 'tasks',
          badge: tasksDue > 0 ? tasksDue : undefined,
        },
        { href: '/app/crm/sequences', label: labels.crm.sequences, active: pathname.startsWith('/app/crm/sequences'), icon: 'flow' },
        { href: '/app/crm/templates', label: labels.crm.templates, active: pathname.startsWith('/app/crm/templates'), icon: 'docs' },
        { href: '/app/crm/forms', label: labels.crm.forms, active: pathname.startsWith('/app/crm/forms'), icon: 'inbox' },
      ],
    },
    {
      section: labels.insights,
      items: [
        { href: '/app/crm/dashboards', label: labels.crm.dashboards, active: pathname.startsWith('/app/crm/dashboards'), icon: 'reports' },
        { href: '/app/crm/reports', label: labels.crm.reports, active: pathname.startsWith('/app/crm/reports'), icon: 'reports' },
      ],
    },
    {
      section: labels.workspace,
      items: [
        { href: '/app/crm/workflows', label: labels.crm.workflows, active: pathname.startsWith('/app/crm/workflows'), icon: 'workflows' },
        { href: '/app/crm/settings', label: labels.crm.settings, active: pathname.startsWith('/app/crm/settings'), icon: 'settings' },
      ],
    },
  ];

  const linkNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app', label: labels.link.overview, active: pathname === '/app', icon: 'overview' }] },
    {
      section: labels.linksSection,
      items: [
        {
          href: '/app/links',
          label: labels.link.links,
          active:
            pathname.startsWith('/app/links') && !pathname.startsWith('/app/links/new') && !pathname.startsWith('/app/links/bio'),
          icon: 'links',
        },
        { href: '/app/links/new', label: labels.link.new, active: pathname.startsWith('/app/links/new'), icon: 'newLink' },
        { href: '/app/links/bio', label: labels.link.bio, active: pathname.startsWith('/app/links/bio'), icon: 'contacts' },
      ],
    },
    {
      section: labels.workspace,
      items: [
        { href: '/app/settings', label: labels.link.settings, active: pathname.startsWith('/app/settings'), icon: 'settings' },
      ],
    },
  ];

  const docsNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/docs', label: labels.docs.overview, active: pathname === '/app/docs', icon: 'overview' }] },
  ];

  const calendarNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/calendar', label: labels.calendar.overview, active: pathname === '/app/calendar', icon: 'overview' }] },
    {
      section: labels.records,
      items: [
        { href: '/app/calendar/event-types', label: labels.calendar.eventTypes, active: pathname.startsWith('/app/calendar/event-types'), icon: 'tasks' },
        { href: '/app/calendar/routing', label: labels.calendar.routing, active: pathname.startsWith('/app/calendar/routing'), icon: 'lists' },
        { href: '/app/calendar/bookings', label: labels.calendar.bookings, active: pathname.startsWith('/app/calendar/bookings'), icon: 'contacts' },
        { href: '/app/calendar/availability', label: labels.calendar.availability, active: pathname.startsWith('/app/calendar/availability'), icon: 'myTasks' },
      ],
    },
    {
      items: [
        { href: '/app/calendar/settings', label: labels.calendar.settings, active: pathname.startsWith('/app/calendar/settings'), icon: 'settings' },
      ],
    },
  ];

  const trackNav: Array<{ section?: string; items: Item[] }> = [
    {
      items: [
        { href: '/app/track', label: labels.track.overview, active: pathname === '/app/track', icon: 'overview' },
        { href: '/app/track/my-tasks', label: labels.track.myTasks, active: pathname.startsWith('/app/track/my-tasks'), icon: 'myTasks' },
      ],
    },
    {
      section: labels.records,
      items: [
        { href: '/app/track/projects', label: labels.track.projects, active: pathname.startsWith('/app/track/projects'), icon: 'lists' },
        { href: '/app/track/issues', label: labels.track.issues, active: pathname.startsWith('/app/track/issues'), icon: 'tasks' },
      ],
    },
    {
      section: labels.activity,
      items: [
        {
          href: '/app/track/inbox',
          label: labels.track.inbox,
          active: pathname.startsWith('/app/track/inbox'),
          icon: 'inbox',
          badge: unreadCount > 0 ? unreadCount : undefined,
        },
      ],
    },
  ];

  const chatNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/chat', label: labels.chat.overview, active: pathname === '/app/chat', icon: 'overview' }] },
    {
      section: labels.records,
      items: [
        { href: '/app/chat/inbox', label: labels.chat.inbox, active: pathname.startsWith('/app/chat/inbox'), icon: 'inbox' },
        { href: '/app/chat/people', label: labels.chat.people, active: pathname.startsWith('/app/chat/people'), icon: 'contacts' },
      ],
    },
    {
      section: labels.insights,
      items: [
        { href: '/app/chat/reports', label: labels.chat.reports, active: pathname.startsWith('/app/chat/reports'), icon: 'reports' },
      ],
    },
    {
      section: labels.workspace,
      items: [
        {
          href: '/app/chat/settings',
          label: labels.chat.settings,
          // Las páginas de un widget cuelgan de Ajustes (ahí está la lista).
          active: pathname.startsWith('/app/chat/settings') || pathname.startsWith('/app/chat/widgets'),
          icon: 'settings',
        },
      ],
    },
  ];

  const flowNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/flow', label: labels.flow.flows, active: pathname.startsWith('/app/flow'), icon: 'flow' }] },
  ];

  const notesNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/notes', label: labels.notes?.all ?? 'Notes', active: pathname.startsWith('/app/notes'), icon: 'notes' }] },
  ];

  const boardNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/board', label: labels.board?.boards ?? 'Boards', active: pathname.startsWith('/app/board'), icon: 'board' }] },
  ];

  const agentsNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/agents', label: labels.agents.agents, active: pathname.startsWith('/app/agents'), icon: 'agents' }] },
  ];

  const robotsNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/robots', label: labels.robots.robots, active: pathname.startsWith('/app/robots'), icon: 'robots' }] },
  ];

  const nav =
    product === 'notes'
      ? notesNav
      : product === 'board'
        ? boardNav
        : product === 'crm'
      ? crmNav
      : product === 'docs'
        ? docsNav
        : product === 'calendar'
          ? calendarNav
          : product === 'track'
            ? trackNav
            : product === 'chat'
              ? chatNav
              : product === 'flow'
                ? flowNav
                : product === 'agents'
                  ? agentsNav
                  : product === 'robots'
                    ? robotsNav
                    : linkNav;

  const newItems: Item[] =
    product === 'notes'
      ? [{ href: '/app/notes?new=1', label: labels.notes?.newNote ?? 'New note', active: false, icon: 'notes' }]
      : product === 'board'
        ? [{ href: '/app/board?new=1', label: labels.board?.newBoard ?? 'New board', active: false, icon: 'board' }]
        : product === 'crm'
      ? [
          { href: '/app/crm/contacts/new', label: labels.newContact, active: false, icon: 'contacts' },
          { href: '/app/crm/companies/new', label: labels.newCompany, active: false, icon: 'companies' },
          { href: '/app/crm/deals/new', label: labels.newDeal, active: false, icon: 'deals' },
          { href: '/app/crm/tasks', label: labels.newTask, active: false, icon: 'tasks' },
        ]
      : product === 'docs'
        ? [{ href: '/app/docs', label: labels.newDocPage, active: false, icon: 'docs' }]
        : product === 'calendar'
          ? [{ href: '/app/calendar/event-types/new', label: labels.newEventType, active: false, icon: 'tasks' }]
          : product === 'track'
            ? [{ href: '/app/track/projects/new', label: labels.newProject, active: false, icon: 'lists' }]
            : product === 'chat'
              ? [{ href: '/app/chat/widgets/new', label: labels.newWidget, active: false, icon: 'chat' }]
              : product === 'flow'
                ? [{ href: '/app/flow', label: labels.newFlow, active: false, icon: 'flow' }]
                : product === 'agents'
                  ? [{ href: '/app/agents', label: labels.newAgent, active: false, icon: 'agents' }]
                  : product === 'robots'
                    ? [{ href: '/app/robots?new=1', label: labels.newRobot, active: false, icon: 'robots' }]
                    : [{ href: '/app/links/new', label: labels.newLink, active: false, icon: 'newLink' }];

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
        <NotificationBell labels={bellLabels} onCountChange={setUnreadCount} />
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
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={collapsed}
        title={collapsed ? 'Expand' : 'Collapse'}
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
          <button type="button" className="side-close" onClick={() => setDrawerOpen(true)} aria-label="menu">
            ☰
          </button>
          <span className="brand-zero" aria-hidden="true">0</span>
        </div>
        <button type="button" className="side-product" onClick={() => setDrawerOpen(true)}>
          <span>{current.name}</span>
          <span className="caret">▾</span>
        </button>
        <div className="app-topbar-right">
          <NotificationBell labels={bellLabels} onCountChange={setUnreadCount} />
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
