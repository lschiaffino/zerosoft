import type { ReactNode } from 'react';

export type TrackIconName =
  | 'settings'
  | 'up'
  | 'down'
  | 'close'
  | 'pencil'
  | 'pin'
  | 'subtasks'
  | 'chevronDown'
  | 'search'
  | 'calendar'
  | 'bold'
  | 'italic'
  | 'code'
  | 'list'
  | 'link'
  | 'bell'
  | 'clock'
  | 'reply'
  | 'smile'
  | 'more'
  | 'check'
  | 'plus'
  | 'grip'
  | 'user'
  | 'tag'
  | 'cycle'
  | 'flag'
  | 'estimate'
  | 'parent'
  | 'eye'
  | 'star'
  | 'users'
  | 'filter'
  | 'refresh'
  | 'tasks'
  | 'plans'
  | 'views'
  | 'archive'
  | 'team'
  | 'redo'
  | 'heading'
  | 'quote'
  | 'image'
  | 'strike'
  | 'numbered'
  | 'divider'
  | 'table'
  | 'todo'
  | 'paperclip'
  | 'toggle'
  | 'callout'
  | 'inbox';

// Trazo de 2px, cuadrado (mismo idioma que components/app/icons.tsx).
const PATHS: Record<TrackIconName, ReactNode> = {
  paperclip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7" />,
  inbox: <path d="M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5" />,
  settings: <path d="M4 7h8M16 7h4M12 4v6M4 17h4M12 17h8M8 14v6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  pin: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3z" />,
  subtasks: <path d="M5 4v12h6M5 10h6M15 7h4M15 16h4" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  search: <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  bold: <path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />,
  italic: <path d="M10 4h8M6 20h8M15 4L9 20" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />,
  link: <path d="M10 14l4-4M9 7l2-2a4 4 0 0 1 6 6l-2 2M15 17l-2 2a4 4 0 0 1-6-6l2-2" />,
  bell: <path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" />,
  clock: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3" />,
  reply: <path d="M10 7L4 12l6 5M4 12h10a6 6 0 0 1 6 6v1" />,
  smile: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  check: <path d="M5 12l5 5 9-10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />,
  user: <path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20a8 8 0 0 1 16 0" />,
  tag: <path d="M4 4h8l8 8-8 8-8-8zM8.5 8.5h.01" />,
  cycle: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  estimate: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  parent: <path d="M6 4v8a4 4 0 0 0 4 4h8M14 12l4 4-4 4" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3z" />,
  users: <path d="M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 4 6" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  eye: <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  tasks: <path d="M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  plans: <path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" />,
  views: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  archive: <path d="M3 4h18v5H3zM5 9v11h14V9M10 13h4" />,
  team: <path d="M4 4h16v16H4zM8 15c1-2 7-2 8 0M12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />,
  redo: <path d="M20 9l-5-5M20 9l-5 5M20 9H9a5 5 0 0 0 0 10h4" />,
  heading: <path d="M5 4v16M15 4v16M5 12h10M19 12v8" />,
  quote: <path d="M5 6v12M10 8h10M10 12h10M10 16h7" />,
  image: <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01" />,
  strike: <path d="M4 12h16M16 6.5A4 4 0 0 0 12 5c-2.5 0-4 1.3-4 3M8 17.5A4 4 0 0 0 12 19c2.5 0 4-1.3 4-3" />,
  numbered: <path d="M10 6h10M10 12h10M10 18h10M4 5h2v4M4 9h3M4 15h3l-3 4h3" />,
  divider: <path d="M3 12h18M7 7h10M7 17h10" />,
  table: <path d="M3 5h18v14H3zM3 10h18M3 15h18M10 5v14" />,
  todo: <path d="M4 5h5v5H4zM5.5 7.5l1 1 1.5-1.8M12 7.5h8M4 14h5v5H4zM12 16.5h8" />,
  toggle: <path d="M5 5l5 4-5 4M13 9h7M9 17h11" />,
  callout: <path d="M4 4h16v16H4zM12 8v.01M12 11v5" />,
};

/** Íconos de trazo de Track. Decorativos: el texto o aria-label va en el control. */
export default function TrackIcon({ name, size = 14 }: { name: TrackIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
