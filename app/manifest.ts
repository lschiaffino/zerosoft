import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isAppHost } from '@/lib/hosts';
import { siteForHost } from '@/lib/docs-site';
import { getHelpWorkspace } from '@/lib/docs-help';

/**
 * App instalable (PWA) de la suite: una sola, para el CRM, Groups y Docs. Abre en
 * /app (el middleware agrega el idioma de la persona) y los atajos llevan a
 * cada app. El único service worker (public/sw.js, registrado desde
 * lib/sw-client.ts) guarda el CRM para usarlo sin red y recibe los push de
 * Groups.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Dominio propio de un sitio de Docs: el manifest es del sitio del cliente, no la app de zerosoft.
  const host = (await headers()).get('host');
  if (host && !isAppHost(host)) {
    const site = await siteForHost(host).catch(() => null);
    const ws = site ? await getHelpWorkspace(site.handle).catch(() => null) : null;
    const name = ws?.name || host;
    return { name, short_name: name.slice(0, 30), start_url: '/', scope: '/', display: 'browser', icons: [] };
  }
  return {
    id: '/app',
    name: 'zerosoft',
    short_name: 'zerosoft',
    description: 'CRM, WhatsApp inbox and docs for teams: contacts, deals, tasks, chats, tickets and pages. The CRM and Docs also work offline.',
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
      { name: 'Docs', url: '/app/docs' },
    ],
  };
}
