import type { ReactNode } from 'react';

export type LinkIconName = 'copy' | 'check' | 'external' | 'qr' | 'edit' | 'archive' | 'unarchive' | 'trash' | 'download' | 'close' | 'duplicate';

// Mismo trazo que components/app/icons (24px, 2px, puntas cuadradas). Sin glifos unicode.
const PATHS: Record<LinkIconName, ReactNode> = {
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v6H4V6h6" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" />
      <path d="M5 8v12h14V8" />
      <path d="M10 12h4" />
    </>
  ),
  unarchive: (
    <>
      <rect x="3" y="4" width="18" height="4" />
      <path d="M5 8v12h14V8" />
      <path d="M12 18v-6M9 14l3-3 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Dos hojas con un más: copia del link (distinto de copiar al portapapeles).
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M16 8V4H4v12h4" />
      <path d="M14 11v6M11 14h6" />
    </>
  ),
};

export default function LinkIcon({ name, size = 16 }: { name: LinkIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
