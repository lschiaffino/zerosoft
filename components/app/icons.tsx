import type { ReactNode } from 'react';

export type IconName =
  | 'overview'
  | 'help'
  | 'contacts'
  | 'companies'
  | 'deals'
  | 'lists'
  | 'leads'
  | 'objects'
  | 'tasks'
  | 'myTasks'
  | 'reports'
  | 'forecast'
  | 'workflows'
  | 'settings'
  | 'links'
  | 'newLink'
  | 'search'
  | 'docs'
  | 'back'
  | 'bell'
  | 'inbox'
  | 'chat'
  | 'feedback'
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
  | 'palette'
  | 'shop'
  | 'discounts'
  | 'social'
  | 'books'
  | 'bank'
  | 'receipt'
  | 'calendar'
  | 'products'
  | 'quotes'
  | 'templates'
  | 'dashboards'
  | 'trash'
  | 'clip'
  | 'recorder'
  | 'bulk'
  | 'domains'
  | 'menu'
  | 'plus'
  | 'close'
  | 'chevronDown'
  | 'chevronRight'
  | 'folder'
  | 'themeSystem'
  | 'themeLight'
  | 'themeDark'
  | 'plans'
  | 'initiatives'
  | 'roadmap'
  | 'cycles'
  | 'insights'
  | 'assistant'
  | 'analytics'
  | 'hiring'
  | 'flag'
  | 'sql'
  | 'live';

// Íconos geométricos mínimos (trazo, estilo Feather/Lucide) para el sidebar.
const PATHS: Record<IconName, ReactNode> = {
  // Asistente de la plataforma: destello (distinto del robot de "Ask AI" del CRM y Docs).
  assistant: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  contacts: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3 4.5-4.5 8-4.5s6.5 1.5 8 4.5" />
    </>
  ),
  companies: (
    <>
      <rect x="5" y="3" width="14" height="18" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
      <path d="M3 21h18" />
    </>
  ),
  deals: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  leads: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  objects: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  lists: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  myTasks: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" />
    </>
  ),
  reports: <path d="M6 20v-7M12 20V5M18 20v-4" />,
  forecast: <path d="M4 18l5-6 4 3 7-9M15 6h5v5" />,
  // Planificación de Track: plan (cuadro con progreso), iniciativa (bandera),
  // roadmap (barras escalonadas), cycles (flecha circular), insights (puntos).
  plans: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M8 12h8M8 16h5M8 8h3" />
    </>
  ),
  initiatives: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4L17 12H5" />
    </>
  ),
  roadmap: <path d="M3 6h9M7 12h10M12 18h9" />,
  cycles: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20h16" />
      <circle cx="7" cy="14" r="1.5" />
      <circle cx="12" cy="9" r="1.5" />
      <circle cx="17" cy="12" r="1.5" />
    </>
  ),
  workflows: (
    <>
      <path d="M4 7h4v10H4zM10 4h4v13h-4zM16 9h4v8h-4z" />
    </>
  ),
  settings: (
    <>
      <path d="M21 4h-7M10 4H3" />
      <path d="M21 12h-9M8 12H3" />
      <path d="M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </>
  ),
  links: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  newLink: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M19 2v6M16 5h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  docs: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2-2.4 3.6M12 17h.01" />
    </>
  ),
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </>
  ),
  feedback: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 7v4M12 14h.01" />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="3" width="6" height="6" />
      <rect x="15" y="15" width="6" height="6" />
      <path d="M6 9v3a3 3 0 0 0 3 3h6" />
    </>
  ),
  notes: (
    <>
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="14" />
      <path d="M7 14l3-4 3 3 4-5" />
      <path d="M9 21h6" />
    </>
  ),
  agents: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
    </>
  ),
  robots: (
    <>
      <rect x="3" y="4" width="18" height="14" />
      <path d="M3 8h18M7 12l2 2-2 2M12 16h4" />
    </>
  ),
  groups: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <circle cx="9.5" cy="10.5" r="1.5" />
      <circle cx="14.5" cy="10.5" r="1.5" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  rec: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </>
  ),
  design: (
    <>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M14 7l3 3" />
      <rect x="3" y="3" width="7" height="7" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
      <circle cx="7.5" cy="11" r="1.2" />
      <circle cx="10" cy="7" r="1.2" />
      <circle cx="15" cy="7.5" r="1.2" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  hiring: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="1" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </>
  ),
  sql: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  live: (
    <>
      <path d="M2 12h4l3-7 4 14 3-7h6" />
    </>
  ),
  talk: (
    <>
      <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />
    </>
  ),
  shop: (
    <>
      <path d="M4 8h16l-1.5 12h-13z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  books: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9l9-5 9 5z" />
      <path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  discounts: (
    <>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.5" />
    </>
  ),
  social: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  products: (
    <>
      <path d="M21 8l-9-5-9 5 9 5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  quotes: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  templates: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 9h18M9 9v12" />
    </>
  ),
  dashboards: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
      <path d="M3 21h18" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3M10 11v6M14 11v6" />
    </>
  ),
  clip: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
    </>
  ),
  recorder: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  bulk: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 12.5l9 5 9-5" />
      <path d="M3 16.5l9 5 9-5" />
    </>
  ),
  domains: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  // Modo de color: pantalla (sistema), sol (claro), luna (oscuro).
  themeSystem: (
    <>
      <rect x="3" y="4" width="18" height="12" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  themeLight: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  themeDark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

export default function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
