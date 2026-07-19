'use client';

import { usePathname } from '@/i18n/navigation';
import Icon from './icons';

interface AppTopbarProps {
  searchLabel?: string;
}

const PRODUCT_NAMES: Record<string, string> = {
  link: 'Link',
  crm: 'CRM',
  docs: 'Docs',
  calendar: 'Cal',
  track: 'Track',
  chat: 'Chat',
};

const PAGE_TITLES: Record<string, string> = {
  '/app': 'Overview',
  '/app/links': 'Links',
  '/app/links/new': 'New link',
  '/app/settings': 'Settings',
  '/app/crm': 'CRM overview',
  '/app/crm/contacts': 'Contacts',
  '/app/crm/companies': 'Companies',
  '/app/crm/deals': 'Deals',
  '/app/crm/lists': 'Lists',
  '/app/crm/tasks': 'Tasks',
  '/app/crm/reports': 'Reports',
  '/app/crm/settings': 'CRM settings',
  '/app/docs': 'Docs',
  '/app/docs/pages': 'Pages',
  '/app/calendar': 'Calendar',
  '/app/calendar/event-types': 'Event types',
  '/app/calendar/bookings': 'Bookings',
  '/app/calendar/availability': 'Availability',
  '/app/calendar/settings': 'Calendar settings',
  '/app/track': 'Track overview',
  '/app/track/projects': 'Projects',
  '/app/track/issues': 'Issues',
  '/app/track/cycles': 'Cycles',
  '/app/track/inbox': 'Inbox',
  '/app/track/settings': 'Track settings',
  '/app/chat': 'Chat overview',
  '/app/chat/inbox': 'Inbox',
  '/app/chat/people': 'People',
  '/app/chat/widgets': 'Widgets',
  '/app/chat/settings': 'Chat settings',
};

export default function AppTopbar({ searchLabel = 'Search' }: AppTopbarProps) {
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

  const productName = PRODUCT_NAMES[product] ?? 'Zerosoft';
  const pageTitle = PAGE_TITLES[pathname] ?? productName;

  function openSearch() {
    window.dispatchEvent(new CustomEvent('zs:open-search'));
  }

  return (
    <div className="app-topbar-inner">
      <div className="app-topbar-product">
        <span className="app-topbar-icon" aria-hidden="true">
          0
        </span>
        <span className="app-topbar-name">{productName}</span>
        <span className="app-topbar-sep" aria-hidden="true">/</span>
        <span className="app-topbar-page">{pageTitle}</span>
      </div>
      <button type="button" className="app-topbar-search" onClick={openSearch}>
        <Icon name="search" />
        <span>{searchLabel}</span>
      </button>
    </div>
  );
}
