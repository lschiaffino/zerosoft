import type { ReactNode } from 'react';

export type NotesIconName = 'pin' | 'share' | 'trash' | 'pencil' | 'close' | 'plus' | 'back' | 'search' | 'clip' | 'ask' | 'grip' | 'more' | 'bell' | 'history' | 'import' | 'link' | 'sticky' | 'timer' | 'vote' | 'track' | 'lock' | 'users' | 'template' | 'focus' | 'mic' | 'scan' | 'check' | 'chevron' | 'export' | 'saved' | 'cloudOff' | 'play' | 'folder' | 'sparkle';

/**
 * Íconos de Notes y Board: mismo trazo que components/app/icons (1.5px,
 * estilo Feather). Los puntos de "más" son cuadrados.
 */
const PATHS: Record<NotesIconName, ReactNode> = {
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />,
  share: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 6l-6 6 6 6" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />,
  clip: <path d="M6 3h12v18l-6-4-6 4V3z" />,
  ask: <path d="M4 5h16v11H9l-5 4V5zM9 10h6" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} strokeLinecap="square" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} strokeLinecap="square" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />,
  history: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2" />,
  import: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />,
  link: <path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />,
  sticky: <path d="M5 4h14v10l-6 6H5V4zM13 20v-6h6" />,
  timer: <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4" />,
  vote: <path d="M4 4h16v16H4zM8 12l3 3 5-6" />,
  track: <path d="M4 5h16M4 12h10M4 19h6M17 15l2 2 3-4" />,
  lock: <path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" />,
  template: <path d="M5 4h14v16H5zM5 9h14M10 9v11" />,
  focus: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  mic: <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3" />,
  scan: <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8" />,
  check: <path d="M5 12l5 5 9-10" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  export: <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14" />,
  saved: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6" />,
  cloudOff: <path d="M3 3l18 18M8 7.5A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2 7.5M16 18H7a4 4 0 0 1-1.5-7.7" />,
  users: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />,
  play: <path d="M7 5l12 7-12 7z" />,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />,
};

export default function NotesIcon({ name, size = 16 }: { name: NotesIconName; size?: number }) {
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
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
