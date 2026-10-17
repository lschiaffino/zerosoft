import type { IconName } from './icons';
import { isNewLinkPath } from '@/lib/link-detail-tabs';

/**
 * Navegación del sidebar de la app, en datos puros (sin React) para poder
 * testearla: qué ítems muestra cada producto, cuál está activo y qué ofrece
 * el menú "+ Nuevo".
 */

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
  /** Ajustes globales de la cuenta (pie del sidebar, todos los productos). */
  settings: string;
  collapse: string;
  expand: string;
  menu: string;
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
  link: { overview: string; links: string; new: string; bio: string; analytics: string; bulk: string; domains: string };
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
    pages: string;
    templates: string;
    trash: string;
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
    credentials: string;
  };
  notes: { all: string; newNote: string; clip: string };
  board: { boards: string; newBoard: string };
  agents: {
    agents: string;
  };
  robots: {
    robots: string;
    recorder: string;
  };
  notifications: {
    title: string;
    markRead: string;
    markAllRead: string;
    empty: string;
  };
}

export interface NavItem {
  href: string;
  label: string;
  active: boolean;
  icon: IconName;
  badge?: number;
}

export interface NavGroup {
  section?: string;
  items: NavItem[];
}

export type AppProduct =
  | 'link'
  | 'crm'
  | 'docs'
  | 'calendar'
  | 'track'
  | 'chat'
  | 'flow'
  | 'notes'
  | 'board'
  | 'agents'
  | 'robots';

const PRODUCT_PREFIXES: Array<[string, AppProduct]> = [
  ['/app/crm', 'crm'],
  ['/app/docs', 'docs'],
  ['/app/calendar', 'calendar'],
  ['/app/track', 'track'],
  ['/app/chat', 'chat'],
  ['/app/flow', 'flow'],
  ['/app/notes', 'notes'],
  ['/app/board', 'board'],
  ['/app/agents', 'agents'],
  ['/app/robots', 'robots'],
];

/** Producto de la app según la ruta (Link es el default: /app, /app/links, /app/settings). */
export function appProductFromPath(pathname: string): AppProduct {
  for (const [prefix, product] of PRODUCT_PREFIXES) {
    if (pathname.includes(prefix)) return product;
  }
  return 'link';
}

/** Ítem global de Ajustes de la cuenta (perfil, API keys, webhooks, dominios, IA). */
export function settingsNavItem(pathname: string, labels: SidebarLabels): NavItem {
  return {
    href: '/app/settings',
    label: labels.settings,
    active: pathname.startsWith('/app/settings'),
    icon: 'settings',
  };
}

export function buildNav(
  product: AppProduct,
  pathname: string,
  labels: SidebarLabels,
  counts: { tasksDue?: number; unread?: number } = {},
): NavGroup[] {
  const at = (prefix: string) => pathname.startsWith(prefix);
  const tasksDue = counts.tasksDue ?? 0;
  const unread = counts.unread ?? 0;

  switch (product) {
    case 'crm':
      return [
        { items: [{ href: '/app/crm', label: labels.crm.overview, active: pathname === '/app/crm', icon: 'overview' }] },
        {
          section: labels.records,
          items: [
            { href: '/app/crm/contacts', label: labels.crm.contacts, active: at('/app/crm/contacts'), icon: 'contacts' },
            { href: '/app/crm/companies', label: labels.crm.companies, active: at('/app/crm/companies'), icon: 'companies' },
            { href: '/app/crm/deals', label: labels.crm.deals, active: at('/app/crm/deals'), icon: 'deals' },
            { href: '/app/crm/lists', label: labels.crm.lists, active: at('/app/crm/lists'), icon: 'lists' },
            { href: '/app/crm/products', label: labels.crm.products, active: at('/app/crm/products'), icon: 'products' },
            { href: '/app/crm/quotes', label: labels.crm.quotes, active: at('/app/crm/quotes'), icon: 'quotes' },
          ],
        },
        {
          section: labels.activity,
          items: [
            {
              href: '/app/crm/tasks',
              label: labels.crm.tasks,
              active: at('/app/crm/tasks'),
              icon: 'tasks',
              badge: tasksDue > 0 ? tasksDue : undefined,
            },
            { href: '/app/crm/sequences', label: labels.crm.sequences, active: at('/app/crm/sequences'), icon: 'flow' },
            { href: '/app/crm/templates', label: labels.crm.templates, active: at('/app/crm/templates'), icon: 'templates' },
            { href: '/app/crm/forms', label: labels.crm.forms, active: at('/app/crm/forms'), icon: 'inbox' },
          ],
        },
        {
          section: labels.insights,
          items: [
            { href: '/app/crm/dashboards', label: labels.crm.dashboards, active: at('/app/crm/dashboards'), icon: 'dashboards' },
            { href: '/app/crm/reports', label: labels.crm.reports, active: at('/app/crm/reports'), icon: 'reports' },
          ],
        },
        {
          section: labels.workspace,
          items: [
            { href: '/app/crm/workflows', label: labels.crm.workflows, active: at('/app/crm/workflows'), icon: 'workflows' },
            { href: '/app/crm/settings', label: labels.crm.settings, active: at('/app/crm/settings'), icon: 'settings' },
          ],
        },
      ];

    case 'docs':
      return [
        {
          items: [
            { href: '/app/docs', label: labels.docs.pages, active: at('/app/docs'), icon: 'docs' },
            // Plantillas y papelera son secciones de la portada de Docs.
            { href: '/app/docs#templates', label: labels.docs.templates, active: false, icon: 'templates' },
            { href: '/app/docs?trash=1#trash', label: labels.docs.trash, active: false, icon: 'trash' },
          ],
        },
      ];

    case 'calendar':
      return [
        { items: [{ href: '/app/calendar', label: labels.calendar.overview, active: pathname === '/app/calendar', icon: 'overview' }] },
        {
          section: labels.records,
          items: [
            { href: '/app/calendar/event-types', label: labels.calendar.eventTypes, active: at('/app/calendar/event-types'), icon: 'tasks' },
            { href: '/app/calendar/routing', label: labels.calendar.routing, active: at('/app/calendar/routing'), icon: 'lists' },
            { href: '/app/calendar/bookings', label: labels.calendar.bookings, active: at('/app/calendar/bookings'), icon: 'contacts' },
            { href: '/app/calendar/availability', label: labels.calendar.availability, active: at('/app/calendar/availability'), icon: 'myTasks' },
          ],
        },
        {
          items: [
            { href: '/app/calendar/settings', label: labels.calendar.settings, active: at('/app/calendar/settings'), icon: 'settings' },
          ],
        },
      ];

    case 'track':
      return [
        {
          items: [
            { href: '/app/track', label: labels.track.overview, active: pathname === '/app/track', icon: 'overview' },
            { href: '/app/track/my-tasks', label: labels.track.myTasks, active: at('/app/track/my-tasks'), icon: 'myTasks' },
          ],
        },
        {
          section: labels.records,
          items: [
            { href: '/app/track/projects', label: labels.track.projects, active: at('/app/track/projects'), icon: 'lists' },
            { href: '/app/track/issues', label: labels.track.issues, active: at('/app/track/issues'), icon: 'tasks' },
          ],
        },
        {
          section: labels.activity,
          items: [
            {
              href: '/app/track/inbox',
              label: labels.track.inbox,
              active: at('/app/track/inbox'),
              icon: 'inbox',
              badge: unread > 0 ? unread : undefined,
            },
          ],
        },
        {
          items: [
            { href: '/app/track/settings', label: labels.track.settings, active: at('/app/track/settings'), icon: 'settings' },
          ],
        },
      ];

    case 'chat':
      return [
        { items: [{ href: '/app/chat', label: labels.chat.overview, active: pathname === '/app/chat', icon: 'overview' }] },
        {
          section: labels.records,
          items: [
            { href: '/app/chat/inbox', label: labels.chat.inbox, active: at('/app/chat/inbox'), icon: 'inbox' },
            { href: '/app/chat/people', label: labels.chat.people, active: at('/app/chat/people'), icon: 'contacts' },
          ],
        },
        {
          section: labels.insights,
          items: [{ href: '/app/chat/reports', label: labels.chat.reports, active: at('/app/chat/reports'), icon: 'reports' }],
        },
        {
          section: labels.workspace,
          items: [
            {
              href: '/app/chat/widgets',
              label: labels.chat.settings,
              // La lista de widgets y las páginas de cada widget (/app/chat/settings redirige acá).
              active: at('/app/chat/widgets') || at('/app/chat/settings'),
              icon: 'settings',
            },
          ],
        },
      ];

    case 'flow':
      return [
        {
          items: [
            { href: '/app/flow', label: labels.flow.flows, active: at('/app/flow') && !at('/app/flow/credentials'), icon: 'flow' },
            { href: '/app/flow/credentials', label: labels.flow.credentials, active: at('/app/flow/credentials'), icon: 'settings' },
          ],
        },
      ];

    case 'notes':
      return [
        {
          items: [
            { href: '/app/notes', label: labels.notes.all, active: at('/app/notes') && !at('/app/notes/clip'), icon: 'notes' },
            { href: '/app/notes/clip', label: labels.notes.clip, active: at('/app/notes/clip'), icon: 'clip' },
          ],
        },
      ];

    case 'board':
      return [{ items: [{ href: '/app/board', label: labels.board.boards, active: at('/app/board'), icon: 'board' }] }];

    case 'agents':
      return [{ items: [{ href: '/app/agents', label: labels.agents.agents, active: at('/app/agents'), icon: 'agents' }] }];

    case 'robots':
      return [
        {
          items: [
            { href: '/app/robots', label: labels.robots.robots, active: at('/app/robots') && !at('/app/robots/recorder'), icon: 'robots' },
            { href: '/app/robots/recorder', label: labels.robots.recorder, active: at('/app/robots/recorder'), icon: 'recorder' },
          ],
        },
      ];

    case 'link':
    default:
      return [
        { items: [{ href: '/app', label: labels.link.overview, active: pathname === '/app', icon: 'overview' }] },
        {
          section: labels.linksSection,
          items: [
            {
              href: '/app/links',
              label: labels.link.links,
              active:
                at('/app/links') &&
                !isNewLinkPath(pathname) &&
                !at('/app/links/bio') &&
                !at('/app/links/analytics') &&
                !at('/app/links/domains'),
              icon: 'links',
            },
            // Una sola entrada para crear: Un link / En lote / Importar son pestañas de /app/links/new.
            { href: '/app/links/new', label: labels.link.new, active: isNewLinkPath(pathname), icon: 'newLink' },
            { href: '/app/links/bio', label: labels.link.bio, active: at('/app/links/bio'), icon: 'contacts' },
            { href: '/app/links/analytics', label: labels.link.analytics, active: at('/app/links/analytics'), icon: 'reports' },
          ],
        },
        {
          section: labels.workspace,
          items: [{ href: '/app/links/domains', label: labels.link.domains, active: at('/app/links/domains'), icon: 'domains' }],
        },
      ];
  }
}

/** Acciones del menú "+ Nuevo": cada una crea algo (ruta /new o ?new=1). */
export function buildNewItems(product: AppProduct, labels: SidebarLabels): NavItem[] {
  const item = (href: string, label: string, icon: IconName): NavItem => ({ href, label, icon, active: false });
  switch (product) {
    case 'crm':
      return [
        item('/app/crm/contacts/new', labels.newContact, 'contacts'),
        item('/app/crm/companies/new', labels.newCompany, 'companies'),
        item('/app/crm/deals/new', labels.newDeal, 'deals'),
        item('/app/crm/tasks?new=1', labels.newTask, 'tasks'),
      ];
    case 'docs':
      return [item('/app/docs?new=1', labels.newDocPage, 'docs')];
    case 'calendar':
      return [item('/app/calendar/event-types/new', labels.newEventType, 'tasks')];
    case 'track':
      return [item('/app/track/projects/new', labels.newProject, 'lists')];
    case 'chat':
      return [item('/app/chat/widgets/new', labels.newWidget, 'chat')];
    case 'flow':
      return [item('/app/flow?new=1', labels.newFlow, 'flow')];
    case 'notes':
      return [item('/app/notes?new=1', labels.notes.newNote, 'notes')];
    case 'board':
      return [item('/app/board?new=1', labels.board.newBoard, 'board')];
    case 'agents':
      return [item('/app/agents?new=1', labels.newAgent, 'agents')];
    case 'robots':
      return [item('/app/robots?new=1', labels.newRobot, 'robots')];
    case 'link':
    default:
      return [item('/app/links/new', labels.newLink, 'newLink')];
  }
}
