import type { TourDef } from './index';

/**
 * Tour de Forms (como Typeform). Textos en common.json › tour.forms.
 * Arranca en la lista (/app/forms) y sigue en el formulario que se abre: el
 * paso "abrí un formulario" se cumple con el clic en una fila, y el motor
 * sigue montado en el layout de Forms al cambiar de página.
 * Anclajes `data-tour`:
 *   forms-new        components/forms/FormsList.tsx (Nuevo formulario)
 *   forms-filters    components/forms/FormsList.tsx (búsqueda y filtro por estado)
 *   forms-item       components/forms/FormsList.tsx (el nombre en cada fila; gana la primera)
 *   forms-questions  components/forms/BuildPanel.tsx (lista de preguntas)
 *   forms-add        components/forms/BuildPanel.tsx (tipo y Agregar pregunta, si no hay preguntas)
 *   forms-publish    components/forms/FormBuilder.tsx (Publicar, o Cerrar si ya está publicado)
 *   forms-share      components/forms/ui.tsx (pestaña Compartir: link, embed, QR)
 *   forms-responses  components/forms/ui.tsx (pestaña Respuestas)
 *   forms-access     components/forms/FormBuilder.tsx (pestaña Ajustes: quién lo ve)
 * Equipo: quién del workspace ve el formulario y sus respuestas.
 * Sin formularios, abrir uno y los pasos del formulario se saltean.
 */
export const FORMS_TOUR = {
  key: 'forms',
  startPath: '/app/forms',
  paths: ['/app/forms'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'newForm', targets: ['forms-new'] },
    { id: 'filters', targets: ['forms-filters'] },
    { id: 'openForm', targets: ['forms-item'], advanceOn: 'click' },
    // Un formulario en blanco no tiene preguntas: entonces resalta Agregar pregunta.
    { id: 'questions', targets: ['forms-questions', 'forms-add'] },
    { id: 'publish', targets: ['forms-publish'] },
    { id: 'share', targets: ['forms-share'] },
    { id: 'responses', targets: ['forms-responses'] },
    { id: 'access', targets: ['forms-access'], audience: 'team' },
    { id: 'done' },
  ],
} as const satisfies TourDef;
