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
  // Bases de datos: abrir fila (panel lateral / página completa) y barra de vista.
  peek: <path d="M3 4h18v16H3zM14 4v16" />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />,
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  sort: <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />,
  group: <path d="M3 4h18v6H3zM3 14h18v6H3z" />,
  eye: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  boardView: <path d="M3 4h5v16H3zM10 4h5v11h-5zM17 4h4v7h-4z" />,
  gallery: <path d="M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z" />,
  // Bloques del editor (tanda D1).
  video: <path d="M3 6h13v12H3zM16 10l5-3v10l-5-3" />,
  audio: <path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  pdf: <path d="M14 3H7v18h10V6zM14 3v3h3M9 12h2a1.5 1.5 0 0 1 0 3H9v-3zM9 15v2" />,
  columns: <path d="M3 4h7v16H3zM14 4h7v16h-7z" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  embed: <path d="M3 5h18v14H3zM9 10l-2 2 2 2M15 10l2 2-2 2" />,
  synced: <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />,
  equation: <path d="M5 6h6M8 6v12M14 9l5 6M19 9l-5 6M4 18h8" />,
  toc: <path d="M4 6h16M8 10h12M8 14h12M4 18h16" />,
  button: <path d="M3 8h18v8H3zM8 12h8" />,
  breadcrumb: <path d="M4 12h3M10 12h3M16 12h4M7 9l3 3-3 3M13 9l3 3-3 3" />,
  calendar: <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  star: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  starFilled: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor" />,
  link: <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L12 5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />,
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  caption: <path d="M3 5h18v10H3zM6 19h12" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  template: <path d="M4 4h16v5H4zM4 13h7v7H4zM15 13h5v7h-5z" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17.5v.5" />,
  history: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2" />,
  // Tanda D4: IA, notas de reunión, bases sincronizadas.
  sparkle: <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />,
  meeting: <path d="M9 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM4 11a5 5 0 0 0 10 0M9 16v4M15 8h5M15 12h5M15 16h5" />,
  sync: <path d="M20 8a8 8 0 0 0-14.5-2M4 4v4h4M4 16a8 8 0 0 0 14.5 2M20 20v-4h-4" />,
  send: <path d="M4 12l16-8-6 16-3-6zM11 14l9-10" />,
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
