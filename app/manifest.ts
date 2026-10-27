import type { MetadataRoute } from 'next';

/**
 * App instalable (PWA) de la suite: una sola, para el CRM y Groups. Abre en
 * /app (el middleware agrega el idioma de la persona) y los atajos llevan a
 * cada app. El único service worker (public/sw.js, registrado desde
 * lib/sw-client.ts) guarda el CRM para usarlo sin red y recibe los push de
 * Groups.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: 'zerosoft',
    short_name: 'zerosoft',
    description: 'CRM and WhatsApp inbox for teams: contacts, deals, tasks, chats and tickets. The CRM also works offline.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
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
      { name: 'Groups inbox', url: '/app/groups/inbox' },
      { name: 'Groups tickets', url: '/app/groups/tickets' },
      { name: 'New note', url: '/app/notes?new=1' },
    ],
    // Compartir un link o un texto desde otra app del teléfono lo guarda en Notes.
    share_target: {
      action: '/app/notes/clip',
      method: 'GET',
      params: { title: 'title', text: 'selection', url: 'url' },
    },
  };
}
