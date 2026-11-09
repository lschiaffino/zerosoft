/**
 * Eventos de ventana de Track, sin dependencias (los importan componentes que
 * no tienen los mensajes del sidebar, como el importador en Ajustes).
 */

/** Vistas favoritas, renombradas o borradas: el sidebar se recarga. */
export const TRACK_VIEWS_CHANGED = 'zs:track-views-changed';

/** Issues movidos desde otro lado (arrastrar, menú contextual, import): listas y sidebar se ponen al día. */
export const TRACK_ISSUES_CHANGED = 'zs:track-issues-changed';
