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
  | 'calendar';

// Trazo de 2px, cuadrado (mismo idioma que components/app/icons.tsx).
const PATHS: Record<TrackIconName, ReactNode> = {
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
