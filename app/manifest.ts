import type { MetadataRoute } from 'next';

/**
 * App instalable (PWA). Abre en el CRM; el middleware agrega el idioma de la
 * persona. El service worker (public/sw.js) guarda las vistas del CRM para
 * usarlas sin red.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app/crm',
    name: 'zerosoft CRM',
    short_name: 'CRM',
    description: 'Contacts, companies, deals and tasks, also offline.',
    start_url: '/app/crm',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0d0d0d',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/api/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/api/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Contacts', url: '/app/crm/contacts' },
      { name: 'Deals', url: '/app/crm/deals' },
      { name: 'Tasks', url: '/app/crm/tasks' },
    ],
  };
}
