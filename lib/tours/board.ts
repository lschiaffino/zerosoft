import type { TourDef } from './index';

/**
 * Tour de Board (pizarras, como Miro). Textos en common.json › tour.board.
 * Arranca en la lista (/app/board) y sigue en el lienzo: el paso "abrí una
 * pizarra" se cumple con el clic en una tarjeta, y el motor sigue montado en
 * el layout de Board al cambiar de página.
 * Anclajes `data-tour`:
 *   board-new           components/board/BoardList.tsx (Nueva pizarra, arriba o en la lista vacía)
 *   board-templates     components/board/BoardList.tsx (plantillas)
 *   board-organize      components/board/BoardList.tsx (búsqueda y carpetas)
 *   board-item          components/board/BoardList.tsx (cada tarjeta; gana la primera)
 *   board-toolbar       components/board/ExcalidrawCanvas.tsx (barra de formas de Excalidraw, marcada desde el DOM)
 *   board-zoom          components/board/ExcalidrawCanvas.tsx (zoom y deshacer de Excalidraw, marcados desde el DOM)
 *   board-canvas-tools  components/board/BoardCanvasTools.tsx (sticky, resaltador, tabla, archivo, minimapa)
 *   board-workshop      components/board/BoardWorkshop.tsx (temporizador y votación)
 *   board-more          components/board/BoardEditor.tsx (menú "Más" de la barra, vía RowMenu tour=)
 *   board-share         components/board/BoardEditor.tsx (Compartir)
 * Equipo: el taller y compartir con el workspace; sola: compartir por link.
 * En el teléfono Excalidraw no muestra zoom ni nuestras herramientas del
 * lienzo: esos pasos se saltean. Sin pizarras, abrir una y los pasos del
 * lienzo se saltean.
 */
export const BOARD_TOUR = {
  key: 'board',
  startPath: '/app/board',
  paths: ['/app/board'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'newBoard', targets: ['board-new'] },
    { id: 'templates', targets: ['board-templates'] },
    { id: 'organize', targets: ['board-organize'] },
    { id: 'openBoard', targets: ['board-item'], advanceOn: 'click' },
    { id: 'toolbar', targets: ['board-toolbar'] },
    { id: 'canvasTools', targets: ['board-canvas-tools'] },
    { id: 'zoom', targets: ['board-zoom'] },
    // Con la barra angosta (casi siempre con el lateral abierto, y en el teléfono) el taller está en "Más".
    { id: 'workshop', targets: ['board-workshop', 'board-more'], audience: 'team' },
    { id: 'share', targets: ['board-share'], audience: 'solo' },
    { id: 'shareTeam', targets: ['board-share'], audience: 'team' },
    { id: 'shortcuts' },
    { id: 'done' },
  ],
} as const satisfies TourDef;
