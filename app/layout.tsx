import type { ReactNode } from 'react';
import '@/styles/brand.css';
import '@/styles/globals.css';
import '@/styles/ui.css';

// El <html> real vive en app/[locale]/layout.tsx (patrón next-intl).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
