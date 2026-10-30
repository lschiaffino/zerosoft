import { importHubHref } from '@/lib/import-registry';
import type { IconName } from './icons';
import { isNewLinkPath } from '@/lib/link-detail-tabs';
import type { NotificationTextLabels } from '@/lib/notification-text';
import { APP_SWITCHER_ORDER, PRODUCT_CONFIG, isBuildingProduct, type ProductCategory, type ProductKey } from '@/lib/products';
import { featuredApps, type WorkspaceMode } from '@/lib/workspace-mode';

/** Resumen de Link (antes vivía en /app, que ahora es el inicio de la plataforma). */
export const LINK_OVERVIEW_HREF = '/app/links/overview';

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
  /** Sidebar del inicio: las apps de la persona arriba y el resto plegado. */
  yourApps: string;
  linksSection: string;
  workspace: string;
  /** Ajustes globales de la cuenta (pie del sidebar, todos los productos). */
  settings: string;
  /** Atajo al hub de importación (pie del sidebar, con la app abierta ya elegida). */
  importData?: string;
  /** Ajustes propios de la app (ítem del sidebar que lleva a /app/<app>/settings). */
  appSettings: string;
  /** Shell neutro (Ajustes de la plataforma): inicio y lista de apps. */
  platformHome: string;
  /** Página del asistente (/app/assistant), debajo del inicio. */
  assistant: string;
  apps: string;
  /** Títulos de las categorías de apps (switcher y sidebar del inicio). */
  categories: Record<ProductCategory, string>;
  /** Encabezados del switcher: destacadas y el resto. */
  featured: string;
  moreApps: string;
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
    forecast: string;
    dashboards: string;
    workflows: string;
    settings: string;
    sequences: string;
    playbooks: string;
    templates: string;
    products: string;
    quotes: string;
    forms: string;
    documents: string;
    videos: string;
    trash: string;
    agents: string;
    /** Botón del asistente del CRM en la banda. */
    askAi: string;
  };
  docs: {
    pages: string;
    templates: string;
    trash: string;
    /** "Ask AI": preguntas sobre todas las páginas. */
    askAi: string;
  };
  calendar: {
    overview: string;
    eventTypes: string;
    bookings: string;
    routing: string;
    availability: string;
    analytics: string;
    settings: string;
    /** Encuestas de horario (opcional: los tests viejos arman labels sin esta clave). */
    polls?: string;
  };
  track: {
    overview: string;
    myTasks: string;
    projects: string;
    issues: string;
    cycles: string;
    settings: string;
    inbox: string;
    /** Planificación (como Linear): plans, initiatives, roadmap, cycles, insights y dashboards. */
    planning?: string;
    plans?: string;
    initiatives?: string;
    roadmap?: string;
    analytics?: string;
    insights?: string;
    dashboards?: string;
    /** Pedidos de clientes (T3). */
    customers?: string;
    /** Secciones como en Linear: "Workspace" y "Your teams". */
    workspace?: string;
    yourTeams?: string;
    more?: string;
  };
  chat: {
    overview: string;
    inbox: string;
    people: string;
    reports: string;
    settings: string;
    teams?: string;
    views?: string;
  };
  flow: {
    flows: string;
    runs: string;
    tables: string;
    variables: string;
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
    tasks: string;
    templates: string;
    broadcasts: string;
    analytics: string;
    settings: string;
  };
  voice: { meetings: string; dictation: string; newMeeting: string };
  /** Rec: Mis videos (con las carpetas colgando), Workspace y grabar. */
  rec: { home: string; workspace: string; newVideo: string };
  /** Design: inicio (con carpetas y diseños colgando), plantillas y kit de marca. */
  design: { home: string; templates: string; brand: string; newDesign: string };
  /** Apps en construcción (Talk ya no; queda el shell genérico): por ahora solo su inicio. */
  talk: { home: string };
  /** Shop: inicio, pedidos, productos, colecciones, inventario, clientes, descuentos, analítica, tienda. */
  shop: {
    home: string;
    orders: string;
    products: string;
    collections: string;
    inventory: string;
    customers: string;
    discounts: string;
    analytics: string;
    store: string;
    newProduct: string;
  };
  /** Analytics (PostHog): web, eventos, insights, tableros, personas, cohortes, flags y SQL. */
  analytics: {
    web: string;
    events: string;
    insights: string;
    dashboards: string;
    persons: string;
    cohorts: string;
    flags: string;
    sql: string;
    projects: string;
    newInsight: string;
  };
  social: { calendar: string; posts: string; inbox: string; analytics: string; library: string; accounts: string; settings: string; newPost: string };
  /** Hiring (Workable): inicio, puestos, candidatos, reportes, plantillas. */
  hiring: {
    home: string;
    jobs: string;
    candidates: string;
    reports: string;
    templates: string;
    careers: string;
    newJob: string;
  };
  /** People (BambooHR): directorio, organigrama, licencias, onboarding, evaluaciones, reportes. */
  people: { directory: string; org: string; timeOff: string; onboarding: string; reviews: string; reports: string; welcome: string; newPerson: string };
  /** Sign (DocuSign): sobres, plantillas. */
  sign: {
    home: string;
    templates: string;
    newEnvelope: string;
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
  /** Solo el hueco del árbol, sin el ítem (Track lista los teams directo bajo "Your teams"). */
  branchOnly?: boolean;
  /** App en construcción: el sidebar le suma la marca "pronto". */
  soon?: boolean;
}

export interface NavGroup {
  section?: string;
  items: NavItem[];
  /** El encabezado pliega el grupo (como el "More" de Linear): cerrado salvo que haya un ítem activo. */
  collapsible?: boolean;
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
  | 'groups'
  | 'voice'
  | 'rec'
  | 'talk'
  | 'design'
  | 'shop'
  | 'analytics'
  | 'social'
  | 'hiring'
  | 'people';
  | 'sign';

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
  ['/app/voice', 'voice'],
  ['/app/rec', 'rec'],
  ['/app/talk', 'talk'],
  ['/app/design', 'design'],
  ['/app/shop', 'shop'],
  ['/app/analytics', 'analytics'],
  ['/app/social', 'social'],
  ['/app/hiring', 'hiring'],
  ['/app/people', 'people'],
  ['/app/sign', 'sign'],
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

/** Ruta de entrada de cada app en el switcher (/app es el inicio de la plataforma). */
export function switcherHref(key: ProductKey): string {
  return PRODUCT_CONFIG[key].launch;
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
  voice: 'voice',
  rec: 'rec',
  talk: 'talk',
  design: 'design',
  shop: 'shop',
  analytics: 'analytics',
  social: 'social',
  hiring: 'hiring',
  people: 'people',
  sign: 'sign',
};

/** Producto de la app según la ruta. /app (inicio) y /app/settings son la plataforma (neutro); /app/links es Link. */
export function appProductFromPath(pathname: string): AppProduct {
  if (pathname === '/app' || pathname === '/app/') return 'home';
  if (pathname === '/app/settings' || pathname.startsWith('/app/settings/')) return 'home';
  // El asistente es de la plataforma (no de una app): shell neutro.
  if (pathname === '/app/assistant' || pathname.startsWith('/app/assistant/')) return 'home';
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

/** Pie del sidebar: "Importar" lleva al hub con la app abierta primero. */
export function importNavItem(product: AppProduct, labels: SidebarLabels): NavItem | null {
  // En el inicio y en Ajustes (shell neutro) no va: la lista de apps necesita el alto y el inicio ya tiene su tarjeta de importar.
  if (!labels.importData || product === 'home') return null;
  const app = product === 'calendar' ? 'cal' : product;
  return {
    href: importHubHref({ app }),
    label: labels.importData,
    // En el hub queda marcado Ajustes (Importar es una sección de Ajustes).
    active: false,
    icon: 'bulk',
  };
}

/** Apps que el inicio muestra arriba: las que la persona usó hace poco y las destacadas del modo. */
export const HOME_APPS_LIMIT = 8;

/**
 * Apps del sidebar del inicio: arriba "Tus apps" (las recientes de la persona,
 * completadas con las destacadas del modo, hasta HOME_APPS_LIMIT) y el resto
 * en "Más apps", plegable con teclado. Sale de PRODUCT_CONFIG: una app nueva
 * entra sola en uno de los dos grupos, sin tocar CSS.
 */
export function homeAppGroups(
  labels: SidebarLabels,
  opts: { allowed?: '*' | readonly string[]; recentApps?: readonly string[]; mode?: WorkspaceMode } = {},
): NavGroup[] {
  const can = (k: ProductKey) => !opts.allowed || opts.allowed === '*' || opts.allowed.includes(k);
  const all = APP_SWITCHER_ORDER.filter(can);
  const recent = (opts.recentApps ?? []).filter((k): k is ProductKey => (all as readonly string[]).includes(k));
  const top = [...new Set([...recent, ...featuredApps({ mode: opts.mode ?? 'team' }).filter(can), ...all])].slice(0, HOME_APPS_LIMIT);
  const rest = all.filter((k) => !top.includes(k));
  const item = (line: ProductKey): NavItem => ({
    href: switcherHref(line),
    label: PRODUCT_CONFIG[line].name,
    active: false,
    icon: APP_ICONS[line],
    soon: isBuildingProduct(line) || undefined,
  });
  const groups: NavGroup[] = [{ section: labels.yourApps, items: top.map(item) }];
  if (rest.length) groups.push({ section: labels.moreApps, items: rest.map(item), collapsible: true });
  return groups;
}

export function buildNav(
  product: AppProduct,
  pathname: string,
  labels: SidebarLabels,
  counts: { tasksDue?: number; unread?: number; allowed?: '*' | readonly string[]; recentApps?: readonly string[]; mode?: WorkspaceMode } = {},
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
      // Inicio y, debajo, las apps agrupadas por categoría (vender, atender…).
      return [
        {
          items: [
            { href: '/app', label: labels.platformHome, active: pathname === '/app', icon: 'overview' },
            { href: '/app/assistant', label: labels.assistant, active: pathname === '/app/assistant' || pathname.startsWith('/app/assistant/'), icon: 'assistant' },
          ],
        },
        ...homeAppGroups(labels, counts),
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
            { href: '/app/crm/playbooks', label: labels.crm.playbooks, active: at('/app/crm/playbooks'), icon: 'notes' },
            { href: '/app/crm/templates', label: labels.crm.templates, active: at('/app/crm/templates'), icon: 'templates' },
            { href: '/app/crm/forms', label: labels.crm.forms, active: at('/app/crm/forms'), icon: 'inbox' },
            { href: '/app/crm/documents', label: labels.crm.documents, active: at('/app/crm/documents'), icon: 'docs' },
            { href: '/app/crm/videos', label: labels.crm.videos, active: at('/app/crm/videos'), icon: 'recorder' },
          ],
        },
        {
          section: labels.insights,
          items: [
            { href: '/app/crm/dashboards', label: labels.crm.dashboards, active: at('/app/crm/dashboards'), icon: 'dashboards' },
            { href: '/app/crm/reports', label: labels.crm.reports, active: at('/app/crm/reports'), icon: 'reports' },
            { href: '/app/crm/forecast', label: labels.crm.forecast, active: at('/app/crm/forecast'), icon: 'forecast' },
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
            { href: '/app/docs?ask=1', label: labels.docs.askAi, active: false, icon: 'agents' },
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
            ...(labels.calendar.polls
              ? [{ href: '/app/calendar/polls', label: labels.calendar.polls, active: at('/app/calendar/polls'), icon: 'insights' as const }]
              : []),
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
      // Como el sidebar de Linear: Inbox y My issues arriba, el workspace
      // (projects, initiatives, vistas de todos los issues) y los teams con
      // sus Issues / Cycles / Projects / Views (TrackBranch).
      return [
        {
          items: [
            {
              href: '/app/track/inbox',
              label: labels.track.inbox,
              active: at('/app/track/inbox'),
              icon: 'inbox',
              badge: unread > 0 ? unread : undefined,
            },
            { href: '/app/track/my-tasks', label: labels.track.myTasks, active: at('/app/track/my-tasks'), icon: 'myTasks' },
          ],
        },
        {
          section: labels.track.workspace ?? labels.records,
          items: [
            ...(labels.track.plans
              ? [
                  { href: '/app/track/projects', label: labels.track.plans, active: pathname === '/app/track/projects' || at('/app/track/projects/'), icon: 'plans' as const },
                  { href: '/app/track/initiatives', label: labels.track.initiatives ?? '', active: at('/app/track/initiatives'), icon: 'initiatives' as const },
                ]
              : []),
            // Todos los issues del workspace: no se marca dentro de un issue (ahí se marca su team).
            { href: '/app/track/issues', label: labels.track.issues, active: pathname === '/app/track/issues', icon: 'tasks' },
          ],
        },
        {
          // Los teams cuelgan directo (TrackBranch en el hueco): Issues, Triage, Cycles, Projects y Views.
          section: labels.track.yourTeams,
          items: [
            { href: '/app/track/teams', label: labels.track.projects, active: false, icon: 'lists', branch: true, branchOnly: true },
          ],
        },
        {
          // Lo menos usado va plegado, como el "More" del sidebar de Linear.
          section: labels.track.more,
          collapsible: true,
          items: [
            ...(labels.track.plans
              ? [{ href: '/app/track/cycles', label: labels.track.cycles, active: at('/app/track/cycles'), icon: 'cycles' as const }]
              : []),
            ...(labels.track.roadmap
              ? [{ href: '/app/track/roadmap', label: labels.track.roadmap, active: at('/app/track/roadmap'), icon: 'roadmap' as const }]
              : []),
            ...(labels.track.customers
              ? [{ href: '/app/track/customers', label: labels.track.customers, active: at('/app/track/customers'), icon: 'contacts' as const }]
              : []),
            ...(labels.track.insights
              ? [
                  { href: '/app/track/insights', label: labels.track.insights ?? '', active: at('/app/track/insights'), icon: 'insights' as const },
                  { href: '/app/track/dashboards', label: labels.track.dashboards ?? '', active: at('/app/track/dashboards'), icon: 'dashboards' as const },
                ]
              : []),
            { href: '/app/track/teams', label: labels.track.projects, active: at('/app/track/teams'), icon: 'lists' },
            { href: '/app/track', label: labels.track.overview, active: pathname === '/app/track', icon: 'overview' },
            // Un solo "Settings" a la vista (el de la cuenta, abajo): los de Track van en More, como en Linear.
            { href: '/app/track/settings', label: labels.appSettings, active: at('/app/track/settings'), icon: 'settings' },
          ],
        },
      ];

    case 'chat':
      return [
        { items: [{ href: '/app/chat', label: labels.chat.overview, active: pathname === '/app/chat', icon: 'overview' }] },
        {
          section: labels.records,
          items: [
            // Siguiendo, bandejas de equipo y vistas guardadas (ChatInboxBranch en el hueco #side-branch).
            { href: '/app/chat/inbox', label: labels.chat.inbox, active: at('/app/chat/inbox'), icon: 'inbox', branch: true },
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
            ...(labels.chat.teams ? [{ href: '/app/chat/teams', label: labels.chat.teams, active: at('/app/chat/teams'), icon: 'groups' as const }] : []),
            ...(labels.chat.views ? [{ href: '/app/chat/views', label: labels.chat.views, active: at('/app/chat/views'), icon: 'lists' as const }] : []),
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
              active:
                at('/app/flow') &&
                !at('/app/flow/credentials') &&
                !at('/app/flow/tables') &&
                !at('/app/flow/settings') &&
                !at('/app/flow/runs') &&
                !at('/app/flow/variables'),
              icon: 'flow',
            },
            { href: '/app/flow/runs', label: labels.flow.runs, active: at('/app/flow/runs'), icon: 'reports' },
            { href: '/app/flow/tables', label: labels.flow.tables, active: at('/app/flow/tables'), icon: 'lists' },
            { href: '/app/flow/variables', label: labels.flow.variables, active: at('/app/flow/variables'), icon: 'objects' },
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
              // Listas guardadas de chats (GroupsListsBranch en el hueco #side-branch).
              branch: true,
            },
            { href: '/app/groups/list', label: labels.groups.groups, active: at('/app/groups/list'), icon: 'groups' },
            { href: '/app/groups/tickets', label: labels.groups.tickets, active: at('/app/groups/tickets'), icon: 'tasks' },
            { href: '/app/groups/tasks', label: labels.groups.tasks, active: at('/app/groups/tasks'), icon: 'myTasks' },
            { href: '/app/groups/templates', label: labels.groups.templates, active: at('/app/groups/templates'), icon: 'templates' },
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

    case 'voice':
      return [
        {
          items: [
            {
              href: '/app/voice',
              label: labels.voice.meetings,
              active: at('/app/voice') && !at('/app/voice/dictation') && !at('/app/voice/settings'),
              icon: 'notes',
            },
            { href: '/app/voice/dictation', label: labels.voice.dictation, active: at('/app/voice/dictation'), icon: 'voice' },
          ],
        },
        appSettingsGroup('/app/voice/settings'),
      ];

    case 'rec':
      return [
        {
          items: [
            {
              href: '/app/rec',
              label: labels.rec.home,
              active: pathname === '/app/rec' || (at('/app/rec') && !at('/app/rec/workspace') && !at('/app/rec/new') && !at('/app/rec/settings') && !at('/app/rec/f/')),
              icon: 'rec',
              // Carpetas (RecBranch en el hueco #side-branch).
              branch: true,
            },
            { href: '/app/rec/workspace', label: labels.rec.workspace, active: at('/app/rec/workspace'), icon: 'companies' },
            { href: '/app/rec/new', label: labels.rec.newVideo, active: at('/app/rec/new'), icon: 'recorder' },
          ],
        },
        appSettingsGroup('/app/rec/settings'),
      ];

    case 'design':
      return [
        {
          items: [
            {
              href: '/app/design',
              label: labels.design.home,
              active: at('/app/design') && !at('/app/design/templates') && !at('/app/design/brand') && !at('/app/design/settings'),
              icon: 'design',
              // Carpetas y diseños recientes (DesignBranch en el hueco #side-branch).
              branch: true,
            },
            { href: '/app/design/templates', label: labels.design.templates, active: at('/app/design/templates'), icon: 'templates' },
            { href: '/app/design/brand', label: labels.design.brand, active: at('/app/design/brand'), icon: 'palette' },
          ],
        },
        appSettingsGroup('/app/design/settings'),
      ];
    case 'analytics': {
      const a = labels.analytics;
      return [
        {
          items: [
            { href: '/app/analytics', label: a.web, active: pathname === '/app/analytics', icon: 'analytics' },
            { href: '/app/analytics/events', label: a.events, active: at('/app/analytics/events'), icon: 'live' },
          ],
        },
        {
          section: labels.insights,
          items: [
            { href: '/app/analytics/insights', label: a.insights, active: at('/app/analytics/insights'), icon: 'insights' },
            // Los tableros cuelgan del ítem (AnalyticsBranch en el hueco #side-branch), como en PostHog.
            { href: '/app/analytics/dashboards', label: a.dashboards, active: at('/app/analytics/dashboards'), icon: 'dashboards', branch: true },
            { href: '/app/analytics/sql', label: a.sql, active: at('/app/analytics/sql'), icon: 'sql' },
          ],
        },
        {
          section: labels.records,
          items: [
            { href: '/app/analytics/persons', label: a.persons, active: at('/app/analytics/persons'), icon: 'contacts' },
            { href: '/app/analytics/cohorts', label: a.cohorts, active: at('/app/analytics/cohorts'), icon: 'groups' },
            { href: '/app/analytics/flags', label: a.flags, active: at('/app/analytics/flags'), icon: 'flag' },
          ],
        },
        {
          items: [
            { href: '/app/analytics/projects', label: a.projects, active: at('/app/analytics/projects'), icon: 'folder' },
            { href: '/app/analytics/settings', label: labels.appSettings, active: at('/app/analytics/settings'), icon: 'settings' },
          ],
        },
      ];
    }

    case 'hiring': {
      const h = labels.hiring;
      return [
        {
          items: [
            { href: '/app/hiring', label: h.home, active: pathname === '/app/hiring', icon: 'overview' },
            { href: '/app/hiring/jobs', label: h.jobs, active: at('/app/hiring/jobs'), icon: 'hiring' },
            { href: '/app/hiring/candidates', label: h.candidates, active: at('/app/hiring/candidates'), icon: 'contacts' },
          ],
        },
        {
          section: labels.insights,
          items: [{ href: '/app/hiring/reports', label: h.reports, active: at('/app/hiring/reports'), icon: 'reports' }],
        },
        {
          items: [
            { href: '/app/hiring/templates', label: h.templates, active: at('/app/hiring/templates'), icon: 'templates' },
            { href: '/app/hiring/settings', label: labels.appSettings, active: at('/app/hiring/settings'), icon: 'settings' },
          ],
        },
      ];
    }

    case 'sign': {
      const s = labels.sign;
      return [
        {
          items: [
            { href: '/app/sign', label: s.home, active: pathname === '/app/sign' || at('/app/sign/envelopes') || at('/app/sign/new'), icon: 'sign' },
            { href: '/app/sign/templates', label: s.templates, active: at('/app/sign/templates'), icon: 'templates' },
          ],
        },
      ];
    }

    case 'shop':
      return [
        {
          items: [
            { href: '/app/shop', label: labels.shop.home, active: pathname === '/app/shop', icon: 'overview' },
            { href: '/app/shop/orders', label: labels.shop.orders, active: at('/app/shop/orders'), icon: 'inbox' },
            { href: '/app/shop/products', label: labels.shop.products, active: at('/app/shop/products'), icon: 'products' },
            { href: '/app/shop/collections', label: labels.shop.collections, active: at('/app/shop/collections'), icon: 'lists' },
            { href: '/app/shop/inventory', label: labels.shop.inventory, active: at('/app/shop/inventory'), icon: 'bulk' },
            { href: '/app/shop/customers', label: labels.shop.customers, active: at('/app/shop/customers'), icon: 'contacts' },
            { href: '/app/shop/discounts', label: labels.shop.discounts, active: at('/app/shop/discounts'), icon: 'discounts' },
          ],
        },
        {
          section: labels.insights,
          items: [{ href: '/app/shop/analytics', label: labels.shop.analytics, active: at('/app/shop/analytics'), icon: 'reports' }],
        },
        appSettingsGroup('/app/shop/settings'),
      ];

    case 'social':
      return [
        {
          items: [
            { href: '/app/social', label: labels.social.calendar, active: pathname === '/app/social' || at('/app/social/calendar'), icon: 'calendar' },
            { href: '/app/social/posts', label: labels.social.posts, active: at('/app/social/posts') || at('/app/social/posts/new'), icon: 'lists' },
            { href: '/app/social/inbox', label: labels.social.inbox, active: at('/app/social/inbox'), icon: 'inbox' },
            { href: '/app/social/library', label: labels.social.library, active: at('/app/social/library'), icon: 'templates' },
          ],
        },
        {
          section: labels.insights,
          items: [{ href: '/app/social/analytics', label: labels.social.analytics, active: at('/app/social/analytics'), icon: 'reports' }],
        },
        {
          items: [
            { href: '/app/social/accounts', label: labels.social.accounts, active: at('/app/social/accounts'), icon: 'social' },
            { href: '/app/social/settings', label: labels.social.settings, active: at('/app/social/settings'), icon: 'settings' },
          ],
        },
      ];

    case 'people': {
      const pl = labels.people;
      const peopleDetail = /^\/app\/people\/emp_/.test(pathname);
      return [
        {
          items: [
            { href: '/app/people', label: pl.directory, active: pathname === '/app/people' || peopleDetail, icon: 'people' },
            { href: '/app/people/org', label: pl.org, active: at('/app/people/org'), icon: 'orgchart' },
            { href: '/app/people/time-off', label: pl.timeOff, active: at('/app/people/time-off'), icon: 'timeoff' },
            { href: '/app/people/onboarding', label: pl.onboarding, active: at('/app/people/onboarding'), icon: 'tasks' },
            { href: '/app/people/reviews', label: pl.reviews, active: at('/app/people/reviews'), icon: 'insights' },
          ],
        },
        {
          section: labels.insights,
          items: [
            { href: '/app/people/reports', label: pl.reports, active: at('/app/people/reports'), icon: 'reports' },
            { href: '/app/people/welcome', label: pl.welcome, active: at('/app/people/welcome'), icon: 'help' },
          ],
        },
        appSettingsGroup('/app/people/settings'),
      ];
    }

    // Shell genérico (inicio y ajustes).
    case 'talk': {
      const base = `/app/${product}`;
      return [
        { items: [{ href: base, label: labels[product].home, active: at(base) && !at(`${base}/settings`), icon: product }] },
        appSettingsGroup(`${base}/settings`),
      ];
    }

    case 'link':
    default:
      return [
        { items: [{ href: LINK_OVERVIEW_HREF, label: labels.link.overview, active: pathname === LINK_OVERVIEW_HREF, icon: 'overview' }] },
        {
          section: labels.linksSection,
          items: [
            {
              href: '/app/links',
              label: labels.link.links,
              active:
                at('/app/links') &&
                pathname !== LINK_OVERVIEW_HREF &&
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
export function buildNewItems(product: AppProduct, labels: SidebarLabels, opts: { docsCanCreate?: boolean } = {}): NavItem[] {
  // Un miembro de solo lectura en Docs no ve "Nueva página" (crearla le daría error).
  if (opts.docsCanCreate === false) return buildNewItems(product, labels).filter((i) => !i.href.startsWith('/app/docs'));
  const item = (href: string, label: string, icon: IconName): NavItem => ({ href, label, icon, active: false });
  switch (product) {
    case 'voice':
      return [item('/app/voice?new=1', labels.voice.newMeeting, 'voice')];
    case 'hiring':
      return [item('/app/hiring/jobs/new', labels.hiring.newJob, 'hiring')];
    case 'sign':
      return [item('/app/sign/new', labels.sign.newEnvelope, 'sign')];
    case 'analytics':
      return [
        item('/app/analytics/insights/new', labels.analytics.newInsight, 'insights'),
        item('/app/analytics/dashboards?new=1', labels.analytics.dashboards, 'dashboards'),
        item('/app/analytics/flags?new=1', labels.analytics.flags, 'flag'),
      ];
    case 'home':
    case 'talk':
      // Sin app activa: crear lo más común de cada una.
      return [
        item('/app/links/new', labels.newLink, 'newLink'),
        item('/app/crm/contacts/new', labels.newContact, 'contacts'),
        item('/app/docs?new=1', labels.newDocPage, 'docs'),
        item('/app/track/teams/new', labels.newProject, 'lists'),
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
      return [item('/app/track/teams/new', labels.newProject, 'lists')];
    case 'chat':
      return [item('/app/chat/widgets/new', labels.newWidget, 'chat')];
    case 'flow':
      return [item('/app/flow?new=1', labels.newFlow, 'flow')];
    case 'notes':
      return [item('/app/notes?new=1', labels.notes.newNote, 'notes')];
    case 'board':
      return [item('/app/board?new=1', labels.board.newBoard, 'board')];
    case 'rec':
      return [item('/app/rec/new', labels.rec.newVideo, 'rec')];
    case 'design':
      return [item('/app/design?new=1', labels.design.newDesign, 'design')];
    case 'shop':
      return [item('/app/shop/products/new', labels.shop.newProduct, 'products')];
    case 'agents':
      return [item('/app/agents?new=1', labels.newAgent, 'agents')];
    case 'robots':
      return [item('/app/robots?new=1', labels.newRobot, 'robots')];
    case 'groups':
      return [item('/app/groups/list?new=1', labels.newGroup, 'groups')];
    case 'social':
      return [item('/app/social/posts/new', labels.social.newPost, 'social')];
    case 'people':
      return [item('/app/people?new=1', labels.people.newPerson, 'people'), item('/app/people/time-off?new=1', labels.people.timeOff, 'timeoff')];
    case 'link':
    default:
      return [item('/app/links/new', labels.newLink, 'newLink')];
  }
}
