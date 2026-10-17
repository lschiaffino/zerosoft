import type { ReactNode } from 'react';
import '@/styles/brand.css';
// Temas de marca: default en :root, los opcionales bajo html[data-brand]
// (ver lib/brand-theme.ts). Un tema nuevo suma su archivo acá.
import '@/styles/themes/default.css';
import '@/styles/themes/subte.css';
import '@/styles/globals.css';
import '@/styles/ui.css';

// El <html> real vive en app/[locale]/layout.tsx (patrón next-intl).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
