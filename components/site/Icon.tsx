import type { ReactNode } from 'react';

/**
 * Íconos de línea (24×24, trazo 1.6) para el sitio de marketing.
 * SVG inline, sin dependencias. Heredan el color con currentColor.
 */
const PATHS: Record<string, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  chart: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h1M18 14h2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  import: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <path d="M15.5 5.6a3.2 3.2 0 010 5.8M17.5 14.8c2 .6 3.2 2.2 3.5 4.7" />
    </>
  ),
  tag: (
    <>
      <path d="M4 12.6V5a1 1 0 011-1h7.6l7.4 7.4-8.6 8.6L4 12.6z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
    </>
  ),
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  kanban: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9.5 4v16M14.5 4v16M5.8 7.5h1.5M11.2 7.5h1.6M16.5 7.5h1.6" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 16.8h2" />
    </>
  ),
  sync: <path d="M19 8.5A7.5 7.5 0 006 7M5 15.5A7.5 7.5 0 0018 17M18.5 4v4.5H14M5.5 20v-4.5H10" />,
  shuffle: <path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.7 0 2.7-1.4 3.4-3M13.1 10c.7-1.6 1.7-3 3.4-3H20M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5" />,
  embed: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 8.5h17M10 12l-2.5 2.5L10 17M14 12l2.5 2.5L14 17" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6L12 3z" />
      <path d="M8.8 12l2.2 2.2 4.2-4.4" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M10 9v11" />
    </>
  ),
  cycle: (
    <>
      <path d="M20 12a8 8 0 11-2.4-5.7" />
      <path d="M20 4.5v4h-4" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  gantt: <path d="M4 4v16h16M7.5 8h6M10 12h7M8.5 16h5" />,
  tree: (
    <>
      <rect x="3.5" y="3.5" width="7" height="5" rx="1" />
      <rect x="13.5" y="10" width="7" height="4.5" rx="1" />
      <rect x="13.5" y="16" width="7" height="4.5" rx="1" />
      <path d="M7 8.5v9.7h6.5M7 12.2h6.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5l2.2-8A1.5 1.5 0 017.7 4.5h8.6a1.5 1.5 0 011.5 1l2.2 8V18a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-4.5z" />
      <path d="M4 13.5h4.5l1 2h5l1-2H20" />
    </>
  ),
  flag: <path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" />,
  hash: <path d="M9.5 4L8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />,
  filter: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z" />,
  message: <path d="M4.5 5.5h15a1 1 0 011 1v10a1 1 0 01-1 1H10l-4.5 3.5V17.5h-1a1 1 0 01-1-1v-10a1 1 0 011-1z" />,
  star: <path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7L12 3.8z" />,
  reply: <path d="M10 6L4 11.5l6 5.5M4.5 11.5H14c3.3 0 6 2.7 6 6v1" />,
  at: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 12v1.5a2.5 2.5 0 005 0V12a8.5 8.5 0 10-3.3 6.7" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="M8.2 10.8l7.1-3.6M8.2 13.2l7.1 3.6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  type: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5M11 16.5h5" />
    </>
  ),
  blocks: (
    <>
      <rect x="4" y="4" width="16" height="4.5" rx="1" />
      <rect x="4" y="11" width="7" height="9" rx="1" />
      <rect x="13" y="11" width="7" height="9" rx="1" />
    </>
  ),
  plug: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 01-11 0v-3zM12 16v4.5" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
    </>
  ),
  bot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 4.5V8M9.5 13h.01M14.5 13h.01M9.5 16h5" />
      <circle cx="12" cy="4" r="1" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName | string;
  size?: number;
  className?: string;
}) {
  if (name === 'github') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 015 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.2 10.2 0 0022 12.2C22 6.6 17.5 2 12 2z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name] ?? PATHS.check}
    </svg>
  );
}
