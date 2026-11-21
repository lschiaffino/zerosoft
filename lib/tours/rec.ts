import type { TourDef } from './index';

/**
 * Tour de Rec (grabar pantalla y cámara para compartir con un link, como Loom).
 * Textos en common.json › tour.rec.
 * Arranca en Mis videos (/app/rec) y sigue en el video que se abre: el paso
 * "abrí un video" se cumple con el clic en una tarjeta, y el motor sigue
 * montado en el layout de Rec al cambiar de página.
 * Anclajes `data-tour`:
 *   rec-record      components/rec/RecLibrary.tsx (Grabar un video, en la cabecera)
 *   rec-upload      components/rec/RecLibrary.tsx (Subir un video)
 *   rec-workspace   components/app/sidebar-nav.ts (Workspace en el lateral: lo que ve todo el equipo)
 *   rec-settings    components/app/sidebar-nav.ts (Ajustes de Rec en el lateral)
 *   rec-video-item  components/rec/RecLibrary.tsx (la primera tarjeta de la lista)
 *   rec-share       components/rec/RecDetail.tsx (Compartir: quién lo ve, contraseña, vencimiento)
 *   rec-insights    components/rec/RecDetail.tsx (pestaña Analítica: quién lo vio y hasta dónde)
 * Equipo: el espacio Workspace. Ajustes, solo para quien administra. En el
 * teléfono el lateral es un cajón: workspace y ajustes se saltean. Sin videos,
 * abrir uno y los pasos del video se saltean, y el tour termina en la lista.
 */
export const REC_TOUR = {
  key: 'rec',
  startPath: '/app/rec',
  paths: ['/app/rec'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'record', targets: ['rec-record'] },
    { id: 'upload', targets: ['rec-upload'] },
    // El lateral antes de abrir un video: en el teléfono se saltea ahí y la cuenta "n de m" no cambia después del clic.
    { id: 'workspace', targets: ['rec-workspace'], audience: 'team' },
    { id: 'settings', targets: ['rec-settings'], adminOnly: true },
    { id: 'openVideo', targets: ['rec-video-item'], advanceOn: 'click' },
    { id: 'share', targets: ['rec-share'] },
    { id: 'insights', targets: ['rec-insights'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
