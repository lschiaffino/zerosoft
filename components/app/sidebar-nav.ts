import type { IconName } from './icons';
import { isNewLinkPath } from '@/lib/link-detail-tabs';
import type { NotificationTextLabels } from '@/lib/notification-text';
import { APP_SWITCHER_ORDER, PRODUCT_CONFIG, type ProductKey } from '@/lib/products';

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
  /** Ajustes propios de la app (ítem del sidebar que lleva a /app/<app>/settings). */
  appSettings: string;
  /** Shell neutro (Ajustes de la plataforma): inicio y lista de apps. */
  platformHome: string;
  apps: string;
  /** Nombre del shell neutro en el switcher. */
  platform: string;
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
  newGroup: string;
  team: string;
  link: { overview: string; links: string; new: string; bio: string; analytics: string; bulk: string; domains: string };
  crm: {
    overview: string;
    contacts: string;
    companies: string;
    deals: string;
    tasks: string;
    lists: string;
    leads: string;
    objects: string;
    reports: string;
    dashboards: string;
    workflows: string;
    settings: string;
    sequences: string;
    templates: string;
    products: string;
    quotes: string;
    forms: string;
    trash: string;
    agents: string;
    /** Botón del asistente del CRM en la banda. */
    askAi: string;
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
    analytics: string;
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
    tables: string;
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
  groups: {
    inbox: string;
    groups: string;
    tickets: string;
    broadcasts: string;
    analytics: string;
    settings: string;
  };
  notifications: {
    title: string;
    markRead: string;
    markAllRead: string;
    empty: string;
    text: NotificationTextLabels;
  };
}

export interface NavItem {
  href: string;
  label: string;
  active: boolean;
  icon: IconName;
  badge?: number;
  /**
   * El ítem tiene un hueco debajo: el producto monta ahí su propio árbol (Docs
   * cuelga sus páginas de "Páginas", Board sus pizarras, Track sus proyectos).
   * El shell deja el hueco #side-branch (uno por producto).
   */
  branch?: boolean;
}

export interface NavGroup {
  section?: string;
  items: NavItem[];
}

export type AppProduct =
  /** Plataforma (Ajustes globales): sin app activa, el shell va neutro. */
  | 'home'
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
  | 'robots'
  | 'groups';

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
  ['/app/groups', 'groups'],
];

/** La app del shell para una clave de producto (Cal vive en /app/calendar). */
export function appProductOf(key: ProductKey): Exclude<AppProduct, 'home'> {
  return key === 'cal' ? 'calendar' : key;
}

/** La clave de producto (color, glifo) de una app del shell; 'home' no tiene. */
export function productKeyOf(product: AppProduct): ProductKey | null {
  if (product === 'home') return null;
  return product === 'calendar' ? 'cal' : product;
}

/** Ruta de entrada de cada app en el switcher (Link sigue entrando por /app). */
export function switcherHref(key: ProductKey): string {
  return key === 'link' ? '/app' : PRODUCT_CONFIG[key].launch;
}

/** Las apps del switcher, en orden, con nombre y ruta desde PRODUCT_CONFIG. */
export const SWITCHER_PRODUCTS: ReadonlyArray<{ key: Exclude<AppProduct, 'home'>; line: ProductKey; name: string; href: string }> =
  APP_SWITCHER_ORDER.map((line) => ({ key: appProductOf(line), line, name: PRODUCT_CONFIG[line].name, href: switcherHref(line) }));

const APP_ICONS: Record<ProductKey, IconName> = {
  link: 'links',
  crm: 'contacts',
  docs: 'docs',
  cal: 'tasks',
  track: 'lists',
  chat: 'chat',
  groups: 'groups',
  flow: 'flow',
  notes: 'notes',
  board: 'board',
  agents: 'agents',
  robots: 'robots',
};

/** Producto de la app según la ruta. /app/settings es la plataforma (neutro); Link es el default (/app, /app/links). */
export function appProductFromPath(pathname: string): AppProduct {
  if (pathname === '/app/settings' || pathname.startsWith('/app/settings/')) return 'home';
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

  // Último grupo de las apps sin "Ajustes" propio en otro lado: lleva a /app/<app>/settings.
  const appSettingsGroup = (href: string): NavGroup => ({
    items: [{ href, label: labels.appSettings, active: at(href), icon: 'settings' }],
  });

  switch (product) {
    case 'home':
      return [
        { items: [{ href: '/app', label: labels.platformHome, active: pathname === '/app', icon: 'overview' }] },
        {
          section: labels.apps,
          items: SWITCHER_PRODUCTS.map((p) => ({ href: p.href, label: p.name, active: false, icon: APP_ICONS[p.line] })),
        },
      ];

    case 'crm':
      return [
        { items: [{ href: '/app/crm', label: labels.crm.overview, active: pathname === '/app/crm', icon: 'overview' }] },
        {
          section: labels.records,
          items: [
            { href: '/app/crm/contacts', label: labels.crm.contacts, active: at('/app/crm/contacts'), icon: 'contacts' },
            { href: '/app/crm/companies', label: labels.crm.companies, active: at('/app/crm/companies'), icon: 'companies' },
            { href: '/app/crm/leads', label: labels.crm.leads, active: at('/app/crm/leads'), icon: 'leads' },
            { href: '/app/crm/deals', label: labels.crm.deals, active: at('/app/crm/deals'), icon: 'deals' },
            { href: '/app/crm/lists', label: labels.crm.lists, active: at('/app/crm/lists'), icon: 'lists' },
            { href: '/app/crm/products', label: labels.crm.products, active: at('/app/crm/products'), icon: 'products' },
            { href: '/app/crm/quotes', label: labels.crm.quotes, active: at('/app/crm/quotes'), icon: 'quotes' },
            // Objetos propios: cada uno cuelga debajo (CrmObjectsBranch en el hueco #side-branch).
            { href: '/app/crm/objects', label: labels.crm.objects, active: pathname === '/app/crm/objects', icon: 'objects', branch: true },
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
            { href: '/app/crm/agents', label: labels.crm.agents, active: at('/app/crm/agents'), icon: 'agents' },
            { href: '/app/crm/settings', label: labels.crm.settings, active: at('/app/crm/settings'), icon: 'settings' },
            { href: '/app/crm/trash', label: labels.crm.trash, active: at('/app/crm/trash'), icon: 'trash' },
          ],
        },
      ];

    case 'docs':
      return [
        {
          items: [
            { href: '/app/docs', label: labels.docs.pages, active: at('/app/docs') && !at('/app/docs/settings'), icon: 'docs', branch: true },
            // Plantillas y papelera son secciones de la portada de Docs.
            { href: '/app/docs#templates', label: labels.docs.templates, active: false, icon: 'templates' },
            { href: '/app/docs?trash=1#trash', label: labels.docs.trash, active: false, icon: 'trash' },
          ],
        },
        appSettingsGroup('/app/docs/settings'),
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
          section: labels.activity,
          items: [
            { href: '/app/calendar/analytics', label: labels.calendar.analytics, active: at('/app/calendar/analytics'), icon: 'reports' },
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
            { href: '/app/track/projects', label: labels.track.projects, active: at('/app/track/projects'), icon: 'lists', branch: true },
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
            {
              href: '/app/flow',
              label: labels.flow.flows,
              active: at('/app/flow') && !at('/app/flow/credentials') && !at('/app/flow/tables') && !at('/app/flow/settings'),
              icon: 'flow',
            },
            { href: '/app/flow/tables', label: labels.flow.tables, active: at('/app/flow/tables'), icon: 'lists' },
            { href: '/app/flow/credentials', label: labels.flow.credentials, active: at('/app/flow/credentials'), icon: 'workflows' },
          ],
        },
        appSettingsGroup('/app/flow/settings'),
      ];

    case 'notes':
      return [
        {
          items: [
            {
              href: '/app/notes',
              label: labels.notes.all,
              active: at('/app/notes') && !at('/app/notes/clip') && !at('/app/notes/settings'),
              icon: 'notes',
            },
            { href: '/app/notes/clip', label: labels.notes.clip, active: at('/app/notes/clip'), icon: 'clip' },
          ],
        },
        appSettingsGroup('/app/notes/settings'),
      ];

    case 'board':
      return [
        {
          items: [
            { href: '/app/board', label: labels.board.boards, active: at('/app/board') && !at('/app/board/settings'), icon: 'board', branch: true },
          ],
        },
        appSettingsGroup('/app/board/settings'),
      ];

    case 'agents':
      return [
        { items: [{ href: '/app/agents', label: labels.agents.agents, active: at('/app/agents') && !at('/app/agents/settings'), icon: 'agents' }] },
        appSettingsGroup('/app/agents/settings'),
      ];

    case 'robots':
      return [
        {
          items: [
            {
              href: '/app/robots',
              label: labels.robots.robots,
              active: at('/app/robots') && !at('/app/robots/recorder') && !at('/app/robots/settings'),
              icon: 'robots',
            },
            { href: '/app/robots/recorder', label: labels.robots.recorder, active: at('/app/robots/recorder'), icon: 'recorder' },
          ],
        },
        appSettingsGroup('/app/robots/settings'),
      ];

    case 'groups':
      return [
        {
          items: [
            {
              href: '/app/groups/inbox',
              label: labels.groups.inbox,
              active: at('/app/groups/inbox') || pathname === '/app/groups',
              icon: 'inbox',
            },
            { href: '/app/groups/list', label: labels.groups.groups, active: at('/app/groups/list'), icon: 'groups' },
            { href: '/app/groups/tickets', label: labels.groups.tickets, active: at('/app/groups/tickets'), icon: 'tasks' },
            { href: '/app/groups/broadcasts', label: labels.groups.broadcasts, active: at('/app/groups/broadcasts'), icon: 'bulk' },
          ],
        },
        {
          section: labels.insights,
          items: [{ href: '/app/groups/analytics', label: labels.groups.analytics, active: at('/app/groups/analytics'), icon: 'reports' }],
        },
        {
          items: [{ href: '/app/groups/settings', label: labels.groups.settings, active: at('/app/groups/settings'), icon: 'settings' }],
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
                !at('/app/links/domains') &&
                !at('/app/links/settings'),
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
          items: [
            {
              href: '/app/links/settings',
              label: labels.appSettings,
              // Dominios, importar y exportar son pestañas de los ajustes de Link (/app/links/domains redirige).
              active: at('/app/links/settings') || at('/app/links/domains'),
              icon: 'settings',
            },
          ],
        },
      ];
  }
}

/** Acciones del menú "+ Nuevo": cada una crea algo (ruta /new o ?new=1). */
export function buildNewItems(product: AppProduct, labels: SidebarLabels): NavItem[] {
  const item = (href: string, label: string, icon: IconName): NavItem => ({ href, label, icon, active: false });
  switch (product) {
    case 'home':
      // Sin app activa: crear lo más común de cada una.
      return [
        item('/app/links/new', labels.newLink, 'newLink'),
        item('/app/crm/contacts/new', labels.newContact, 'contacts'),
        item('/app/docs?new=1', labels.newDocPage, 'docs'),
        item('/app/track/projects/new', labels.newProject, 'lists'),
        item('/app/calendar/event-types/new', labels.newEventType, 'tasks'),
        item('/app/notes?new=1', labels.notes.newNote, 'notes'),
      ];
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
    case 'groups':
      return [item('/app/groups/list?new=1', labels.newGroup, 'groups')];
    case 'link':
    default:
      return [item('/app/links/new', labels.newLink, 'newLink')];
  }
}
