import type { TourDef } from './index';

/**
 * Tour de Flow (automatizaciones, como Zapier o n8n). Textos en
 * common.json › tour.flow.
 * Arranca en la lista (/app/flow) y, si ya hay flows, sigue en el editor del
 * que se abre: el paso "abrí un flow" se cumple con el clic en una fila, y el
 * motor sigue montado en el layout de Flow al cambiar de página.
 * Anclajes `data-tour`:
 *   flow-new          components/flow/FlowsHome.tsx (Nuevo flow, quien puede editar flows)
 *   flow-template     components/flow/FlowsHome.tsx (la primera plantilla)
 *   flow-runs         components/app/sidebar-nav.ts (Historial en el lateral)
 *   flow-history      components/flow/FlowsHome.tsx (Historial junto a los filtros: en el teléfono)
 *   flow-credentials  components/app/sidebar-nav.ts (Credenciales en el lateral)
 *   flow-item         components/flow/FlowsHome.tsx (el nombre en cada fila; gana la primera)
 *   flow-trigger      components/flow/FlowNodeCard.tsx (el disparador en el lienzo)
 *   flow-add-step     components/flow/FlowEditor.tsx (los pasos para sumar, o Agregar paso)
 *   flow-test         components/flow/FlowEditor.tsx (Probar)
 * Crear un flow y los pasos del editor que cambian algo son de quien puede
 * editar (admin): sin el botón, el paso se saltea. Sin flows, abrir uno y el
 * editor se saltean. En el teléfono el lateral es un cajón: el historial
 * señala el link de la lista y las credenciales se saltean.
 */
export const FLOW_TOUR = {
  key: 'flow',
  startPath: '/app/flow',
  paths: ['/app/flow'],
  steps: [
    { id: 'intro' },
    { id: 'newFlow', targets: ['flow-new'] },
    { id: 'templates', targets: ['flow-template'] },
    { id: 'runs', targets: ['flow-runs', 'flow-history'] },
    { id: 'credentials', targets: ['flow-credentials'] },
    { id: 'openFlow', targets: ['flow-item'], advanceOn: 'click' },
    { id: 'trigger', targets: ['flow-trigger'] },
    { id: 'addStep', targets: ['flow-add-step'] },
    { id: 'test', targets: ['flow-test'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
