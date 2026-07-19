'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Link, usePathname } from '@/i18n/navigation';

export interface SidebarLabels {
  search: string;
  new: string;
  backToSite: string;
  docs: string;
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
  link: { overview: string; links: string; new: string; settings: string };
  crm: {
    overview: string;
    contacts: string;
    companies: string;
    deals: string;
    tasks: string;
    lists: string;
    reports: string;
    settings: string;
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
}

const PRODUCTS = [
  { key: 'link', name: 'Link', href: '/app' },
  { key: 'crm', name: 'CRM', href: '/app/crm' },
  { key: 'track', name: 'Track', href: null },
  { key: 'cal', name: 'Cal', href: null },
] as const;

/**
 * Chrome de las apps: sidebar por producto estilo Twenty (switcher, búsqueda,
 * secciones agrupadas, quick actions, usuario abajo). Reemplaza al AppShell
 * de tabs. En <1024px colapsa a topbar + drawer.
 */
export default function AppSidebar({
  labels,
  user,
  demo,
}: {
  labels: SidebarLabels;
  user: SideUser;
  demo: boolean;
}) {
  const pathname = usePathname();
  const product = pathname.includes('/app/crm') ? 'crm' : 'link';
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const crmNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app/crm', label: labels.crm.overview, active: pathname === '/app/crm' }] },
    {
      section: labels.records,
      items: [
        { href: '/app/crm/contacts', label: labels.crm.contacts, active: pathname.startsWith('/app/crm/contacts') },
        { href: '/app/crm/companies', label: labels.crm.companies, active: pathname.startsWith('/app/crm/companies') },
        { href: '/app/crm/deals', label: labels.crm.deals, active: pathname.startsWith('/app/crm/deals') },
        { href: '/app/crm/lists', label: labels.crm.lists, active: pathname.startsWith('/app/crm/lists') },
      ],
    },
    {
      section: labels.activity,
      items: [
        { href: '/app/crm/tasks', label: labels.crm.tasks, active: pathname.startsWith('/app/crm/tasks') },
      ],
    },
    {
      section: labels.insights,
      items: [
        { href: '/app/crm/reports', label: labels.crm.reports, active: pathname.startsWith('/app/crm/reports') },
      ],
    },
    {
      section: labels.workspace,
      items: [
        { href: '/app/crm/settings', label: labels.crm.settings, active: pathname.startsWith('/app/crm/settings') },
      ],
    },
  ];

  const linkNav: Array<{ section?: string; items: Item[] }> = [
    { items: [{ href: '/app', label: labels.link.overview, active: pathname === '/app' }] },
    {
      section: labels.linksSection,
      items: [
        {
          href: '/app/links',
          label: labels.link.links,
          active: pathname.startsWith('/app/links') && !pathname.startsWith('/app/links/new'),
        },
        { href: '/app/links/new', label: labels.link.new, active: pathname.startsWith('/app/links/new') },
      ],
    },
    {
      section: labels.workspace,
      items: [
        { href: '/app/settings', label: labels.link.settings, active: pathname.startsWith('/app/settings') },
      ],
    },
  ];

  const nav = product === 'crm' ? crmNav : linkNav;

  const newItems: Item[] =
    product === 'crm'
      ? [
          { href: '/app/crm/contacts/new', label: labels.newContact, active: false },
          { href: '/app/crm/companies/new', label: labels.newCompany, active: false },
          { href: '/app/crm/deals', label: labels.newDeal, active: false },
          { href: '/app/crm/tasks', label: labels.newTask, active: false },
        ]
      : [{ href: '/app/links/new', label: labels.newLink, active: false }];

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
            <span>0 {current.name}</span>
            <span className="caret">▾</span>
          </button>
          {switcherOpen && (
            <div className="side-menu" role="menu">
              {PRODUCTS.map((p) =>
                p.href ? (
                  <Link key={p.key} href={p.href} onClick={() => setSwitcherOpen(false)}>
                    {p.key === product ? '●' : '○'} 0 {p.name}
                  </Link>
                ) : (
                  <span key={p.key}>
                    ○ 0 {p.name} <em className="side-soon">{labels.soon}</em>
                  </span>
                ),
              )}
            </div>
          )}
        </div>
        <button type="button" className="side-close" onClick={() => setDrawerOpen(false)}>
          ✕
        </button>
      </div>

      <button type="button" className="side-search" onClick={openSearch}>
        <span>{labels.search}</span>
        <kbd>⌘K</kbd>
      </button>

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
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <Link href="/" className="side-link">
          {labels.backToSite}
        </Link>
        <Link href="/docs" className="side-link">
          {labels.docs}
        </Link>
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
          <Link href="/" className="side-signout" style={{ textDecoration: 'none', display: 'block' }}>
            {labels.signOut}
          </Link>
        ) : (
          <button type="button" className="side-signout" onClick={() => signOut({ callbackUrl: '/' })}>
            {labels.signOut}
          </button>
        )}
        <div className="side-zero" aria-hidden="true">
          0
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="app-topbar">
        <button type="button" className="side-close" onClick={() => setDrawerOpen(true)} aria-label="menu">
          ☰
        </button>
        <button type="button" className="side-product" onClick={() => setDrawerOpen(true)}>
          <span>0 {current.name}</span>
          <span className="caret">▾</span>
        </button>
        <button type="button" className="side-close" onClick={openSearch} aria-label={labels.search}>
          ⌘K
        </button>
      </div>
      {drawerOpen && <div className="side-backdrop" onClick={() => setDrawerOpen(false)} />}
      {aside}
    </>
  );
}
