import type { ReactNode } from 'react';
import '@/styles/brand.css';
// Tema de marca: default en :root (ver lib/brand-theme.ts). Un tema nuevo
// suma su archivo acá, con sus tokens bajo html[data-brand="<tema>"].
import '@/styles/themes/default.css';
import '@/styles/globals.css';
import '@/styles/ui.css';
// Modo oscuro (sistema o data-theme="dark", ver lib/color-theme.ts).
import '@/styles/themes/dark.css';

// El <html> real vive en app/[locale]/layout.tsx (patrón next-intl).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
