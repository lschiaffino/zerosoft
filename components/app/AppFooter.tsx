'use client';

import { Link, usePathname } from '@/i18n/navigation';

interface AppFooterProps {
  backToSite?: string;
}

const PRODUCT_LINKS: Record<string, Array<{ href: string; label: string }>> = {
  crm: [
    { href: '/app/crm/contacts', label: 'Contacts' },
    { href: '/app/crm/companies', label: 'Companies' },
    { href: '/app/crm/deals', label: 'Deals' },
    { href: '/app/crm/reports', label: 'Reports' },
  ],
  track: [
    { href: '/app/track/projects', label: 'Projects' },
    { href: '/app/track/issues', label: 'Issues' },
    { href: '/app/track/inbox', label: 'Inbox' },
  ],
  chat: [
    { href: '/app/chat/inbox', label: 'Inbox' },
    { href: '/app/chat/people', label: 'People' },
    { href: '/app/chat', label: 'Widgets' },
    { href: '/app/chat/settings', label: 'Settings' },
  ],
  docs: [
    { href: '/app/docs', label: 'Overview' },
    { href: '/docs', label: 'Docs site' },
  ],
  calendar: [
    { href: '/app/calendar/event-types', label: 'Event types' },
    { href: '/app/calendar/bookings', label: 'Bookings' },
    { href: '/app/calendar/routing', label: 'Routing' },
    { href: '/app/calendar/settings', label: 'Settings' },
  ],
  link: [
    { href: '/app', label: 'Overview' },
    { href: '/app/links', label: 'Links' },
    { href: '/app/links/new', label: 'New link' },
    { href: '/app/settings', label: 'Settings' },
  ],
};

export default function AppFooter({ backToSite = 'Back to site' }: AppFooterProps) {
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
            : 'link';

  const links = PRODUCT_LINKS[product] ?? PRODUCT_LINKS.link;

  return (
    <footer className="app-footer">
      <div className="app-footer-product">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="app-footer-legal">
        <Link href="/">{backToSite}</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/security">Security</Link>
      </div>
      <span className="app-footer-zero" aria-hidden="true">
        0
      </span>
    </footer>
  );
}
