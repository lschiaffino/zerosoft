import type { ReactNode } from 'react';

export type IconName =
  | 'overview'
  | 'contacts'
  | 'companies'
  | 'deals'
  | 'lists'
  | 'tasks'
  | 'myTasks'
  | 'reports'
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
  | 'agents';

// Íconos geométricos mínimos (trazo, estilo Feather/Lucide) para el sidebar.
const PATHS: Record<IconName, ReactNode> = {
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
};

export default function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width={14}
      height={14}
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
