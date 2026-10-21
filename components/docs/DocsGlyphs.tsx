/** Íconos propios de Docs que el set del shell (components/app/icons) no tiene. Mismo trazo: 1.5. */
const PATHS = {
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={2.4} />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  // Página sin ícono propio en el árbol.
  page: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  // Tipos de bloque (menú "/" y "Convertir en").
  paragraph: <path d="M5 6h14M12 6v13" />,
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  bulleted: <path d="M10 7h10M10 12h10M10 17h10M4 6h2v2H4zM4 11h2v2H4zM4 16h2v2H4z" />,
  numbered: <path d="M10 7h10M10 12h10M10 17h10M4 5h1.5v4M4 13.5h2.5L4 17h2.5" />,
  todo: <path d="M4 4h16v16H4zM8 12l3 3 5-6" />,
  quote: <path d="M5 5v14M10 8h9M10 12h9M10 16h6" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  divider: <path d="M3 12h18" />,
  table: <path d="M3 5h18v14H3zM3 10h18M3 15h18M10 5v14" />,
  database: <path d="M3 5h18v14H3zM3 9h18M8 9v10" />,
  image: <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01" />,
  file: <path d="M14 3H7v18h10V6zM14 3v3h3M10 13h4M10 17h4" />,
  board: <path d="M3 4h18v14H3zM7 14l3-4 3 3 4-5M9 21h6" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5" />,
  // Toggle (triángulo que rota al desplegar) y callout (recuadro con marca).
  toggle: <path d="M9 6l6 6-6 6" />,
  callout: <path d="M3 5h18v14H3zM7 9v2M11 9h6M11 13h6M7 15h.01" />,
} as const;

export type DocsGlyphName = keyof typeof PATHS;

export default function DocsGlyph({ name, size = 16 }: { name: DocsGlyphName; size?: number }) {
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
