import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { isAppHost } from '@/lib/hosts';
import { siteForHost } from '@/lib/docs-site';
import { getHelpWorkspace } from '@/lib/docs-help';

/**
 * App instalable (PWA) de la suite: una sola para toda la plataforma (Talk,
 * Voice, Docs, CRM, Track, Cal…). Abre en /app (el middleware agrega el
 * idioma de la persona) y los atajos llevan a cada app. El único service
 * worker (public/sw.js, registrado desde lib/sw-client.ts en todas las apps
 * por components/app/AppPwa.tsx) guarda el CRM y Docs para usarlos sin red y
 * recibe los push de Groups y Talk.
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
    description: 'Every zerosoft app in one place: Talk, Voice, Docs, CRM, Track, Cal, Notes and more. The CRM and Docs also work offline.',
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
    // Chrome muestra hasta 10 (Android, ~4): primero lo de todos los días.
    shortcuts: [
      { name: 'Talk', url: '/app/talk' },
      { name: 'New meeting notes', short_name: 'Meeting notes', url: '/app/voice?new=1' },
      { name: 'Docs', url: '/app/docs' },
      { name: 'New note', url: '/app/notes?new=1' },
      { name: 'Deals', url: '/app/crm/deals' },
      { name: 'Contacts', url: '/app/crm/contacts' },
      { name: 'Track', url: '/app/track' },
      { name: 'Cal', url: '/app/calendar' },
      { name: 'Groups inbox', url: '/app/groups/inbox' },
      { name: 'Tasks', url: '/app/crm/tasks' },
    ],
    // Compartir un link o un texto desde otra app del teléfono lo guarda en Notes.
    share_target: {
      action: '/app/notes/clip',
      method: 'GET',
      params: { title: 'title', text: 'selection', url: 'url' },
    },
  };
}
