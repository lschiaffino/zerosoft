'use client';

import { Link, usePathname } from '@/i18n/navigation';

export interface AppShellLabels {
  switcherLink: string;
  switcherCrm: string;
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

interface Tab {
  href: string;
  label: string;
  active: boolean;
}

/**
 * Shell del dashboard: switcher de producto (Link / CRM) + tabs del producto
 * activo. El producto se deduce del pathname; los labels llegan traducidos
 * por props desde el layout server.
 */
export default function AppShell({ labels }: { labels: AppShellLabels }) {
  const pathname = usePathname();
  const product = pathname.includes('/app/crm') ? 'crm' : 'link';

  const linkTabs: Tab[] = [
    { href: '/app', label: labels.link.overview, active: pathname === '/app' },
    {
      href: '/app/links',
      label: labels.link.links,
      active: pathname.startsWith('/app/links') && !pathname.startsWith('/app/links/new'),
    },
    {
      href: '/app/links/new',
      label: labels.link.new,
      active: pathname.startsWith('/app/links/new'),
    },
    {
      href: '/app/settings',
      label: labels.link.settings,
      active: pathname.startsWith('/app/settings'),
    },
  ];

  const crmTabs: Tab[] = [
    { href: '/app/crm', label: labels.crm.overview, active: pathname === '/app/crm' },
    {
      href: '/app/crm/contacts',
      label: labels.crm.contacts,
      active: pathname.startsWith('/app/crm/contacts'),
    },
    {
      href: '/app/crm/companies',
      label: labels.crm.companies,
      active: pathname.startsWith('/app/crm/companies'),
    },
    {
      href: '/app/crm/deals',
      label: labels.crm.deals,
      active: pathname.startsWith('/app/crm/deals'),
    },
    {
      href: '/app/crm/tasks',
      label: labels.crm.tasks,
      active: pathname.startsWith('/app/crm/tasks'),
    },
    {
      href: '/app/crm/lists',
      label: labels.crm.lists,
      active: pathname.startsWith('/app/crm/lists'),
    },
    {
      href: '/app/crm/reports',
      label: labels.crm.reports,
      active: pathname.startsWith('/app/crm/reports'),
    },
    {
      href: '/app/crm/settings',
      label: labels.crm.settings,
      active: pathname.startsWith('/app/crm/settings'),
    },
  ];

  const tabs = product === 'crm' ? crmTabs : linkTabs;

  return (
    <div className="app-nav">
      <div className="switcher" aria-label="product">
        <Link
          href="/app"
          className={`switcher-item${product === 'link' ? ' active' : ''}`}
          aria-current={product === 'link' ? 'page' : undefined}
        >
          {labels.switcherLink}
        </Link>
        <Link
          href="/app/crm"
          className={`switcher-item${product === 'crm' ? ' active' : ''}`}
          aria-current={product === 'crm' ? 'page' : undefined}
        >
          {labels.switcherCrm}
        </Link>
      </div>
      <nav className="app-tabs">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className={`app-tab${tab.active ? ' active' : ''}`}>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
