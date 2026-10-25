/** Íconos de las bases que no están en DocsGlyphs (mismo trazo: 1.5). */
const PATHS = {
  table: <path d="M3 5h18v14H3zM3 10h18M3 15h18M10 5v14" />,
  board: <path d="M3 4h5v16H3zM10 4h5v11h-5zM17 4h4v7h-4z" />,
  gallery: <path d="M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z" />,
  list: <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2} />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />,
  timeline: <path d="M4 5h9M8 10h10M6 15h7M11 20h9" strokeWidth={2.2} />,
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
} as const;

export type DbGlyphName = keyof typeof PATHS;

export default function DbGlyph({ name, size = 14 }: { name: DbGlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
