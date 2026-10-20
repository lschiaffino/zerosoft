import type { ReactNode } from 'react';

export type NotesIconName = 'pin' | 'share' | 'trash' | 'pencil' | 'close' | 'plus' | 'back' | 'search' | 'clip' | 'ask' | 'grip' | 'more' | 'history';

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
  history: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 8v4l3 2" />,
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
