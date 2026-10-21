import type { ReactNode } from 'react';

type CalIconName = 'external' | 'copy' | 'check' | 'prev' | 'next' | 'plus' | 'close' | 'trash' | 'clock' | 'pin' | 'globe' | 'card' | 'people';

// Mismo trazo que components/app/icons.tsx (1.5, puntas redondas), para lo que Cal usa y el set del shell no tiene.
const PATHS: Record<CalIconName, ReactNode> = {
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  clock: (
    <>
      <path d="M12 7v5l3 2" />
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <path d="M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
    </>
  ),
  globe: (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="1" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  people: (
    <>
      <path d="M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
      <path d="M3 20c.5-3.4 3-5.5 6-5.5s5.5 2.1 6 5.5M16 5a3 3 0 0 1 0 6M18 14.8c1.7.7 2.8 2.6 3 5.2" />
    </>
  ),
};

export default function CalIcon({ name, size = 14 }: { name: CalIconName; size?: number }) {
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
