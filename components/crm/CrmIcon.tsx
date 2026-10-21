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
