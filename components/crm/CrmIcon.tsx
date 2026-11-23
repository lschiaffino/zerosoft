/**
 * Íconos de línea del CRM (trazo 2, 24×24, currentColor), en lugar de
 * glifos unicode o emoji. Decorativos: el botón que los contiene
 * lleva su aria-label.
 */
const PATHS = {
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  panel: 'M3 4h18v16H3zM14 4v16',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  pin: 'M9 3h6M10 3v6l-4 5h12l-4-5V3M12 14v7',
  /** Burbuja de mensaje (WhatsApp). */
  message: 'M4 5h16v11H10l-6 4z',
  /** Llamada desde el navegador. */
  headset: 'M4 15v-3a8 8 0 0116 0v3M4 14h3v6H4zM17 14h3v6h-3z',
  mic: 'M9 3h6v10H9zM5 11a7 7 0 0014 0M12 18v3',
  micOff: 'M9 3h6v10H9zM5 11a7 7 0 0014 0M12 18v3M4 4l16 16',
  hangup: 'M3 14c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 00-6 0v3l-4 1z',
  /** Timeline: tipos de actividad y herramientas. */
  note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  task: 'M4 4h16v16H4zM8 12l3 3 5-6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  search: 'M10.5 17a6.5 6.5 0 110-13 6.5 6.5 0 010 13zM15.5 15.5L20 20',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  chevronRight: 'M9 6l6 6-6 6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  keypad: 'M6 4h2M11 4h2M16 4h2M6 9h2M11 9h2M16 9h2M6 14h2M11 14h2M16 14h2M11 19h2',
} as const;

export type CrmIconName = keyof typeof PATHS;

export default function CrmIcon({ name, size = 14 }: { name: CrmIconName; size?: number }) {
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
      <path d={PATHS[name]} />
    </svg>
  );
}
