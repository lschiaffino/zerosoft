import type { TourDef } from './index';

/**
 * Tour de Social (calendario, publicaciones, bandeja y métricas, como Buffer
 * o Hootsuite). Textos en common.json › tour.social.
 * Arranca en el calendario (/app/social) y no cambia de página: lo demás está
 * en el lateral de la app.
 * Anclajes `data-tour`:
 *   social-connect    app/[locale]/app/social/(home)/page.tsx (vacío: conectá tu primera cuenta)
 *   social-accounts   components/app/sidebar-nav.ts (Cuentas en el lateral, si ya hay cuentas)
 *   social-new-post   app/[locale]/app/social/(home)/page.tsx (Nueva publicación)
 *   social-calendar   components/social/CalendarView.tsx (barra del calendario: hoy, mes o semana)
 *   social-posts      components/app/sidebar-nav.ts (Publicaciones: borradores, aprobación, programadas)
 *   social-inbox      components/app/sidebar-nav.ts (Bandeja: comentarios, menciones y mensajes)
 *   social-analytics  components/app/sidebar-nav.ts (Analíticas)
 *   social-settings   components/app/sidebar-nav.ts (Ajustes: quién publica solo y quién pide aprobación)
 * Sin cuentas ni publicaciones la página muestra el vacío y no el calendario:
 * el paso de cuentas señala el vacío y el del calendario se saltea. En el
 * teléfono el lateral es un cajón: publicaciones, bandeja, analíticas y
 * ajustes se saltean. Los ajustes son de equipo y de quien administra.
 */
export const SOCIAL_TOUR = {
  key: 'social',
  startPath: '/app/social',
  paths: ['/app/social'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'accounts', targets: ['social-connect', 'social-accounts'] },
    { id: 'newPost', targets: ['social-new-post'] },
    { id: 'calendar', targets: ['social-calendar'] },
    { id: 'posts', targets: ['social-posts'] },
    { id: 'inbox', targets: ['social-inbox'] },
    { id: 'analytics', targets: ['social-analytics'] },
    { id: 'settings', targets: ['social-settings'], audience: 'team', adminOnly: true },
    { id: 'done' },
  ],
} as const satisfies TourDef;
