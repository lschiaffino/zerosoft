import type { TourDef } from './index';

/**
 * Tour de Agents (agentes de IA que atienden en Chat, una página pública o la
 * API). Textos en common.json › tour.agents.
 * Arranca en la lista (/app/agents) y, si ya hay agentes, sigue en el editor
 * del que se abre: el paso "abrí un agente" se cumple con el clic en una fila,
 * y el motor sigue montado en el layout de Agents al cambiar de página.
 * Anclajes `data-tour`:
 *   agents-new                 components/agents/AgentsHome.tsx (Crear agente, quien puede editar agentes)
 *   agents-template            components/agents/AgentsHome.tsx (la primera plantilla)
 *   agents-item                components/agents/AgentsHome.tsx (el nombre en cada fila; gana la primera)
 *   agents-tabs                components/agents/AgentEditor.tsx (las pestañas del editor)
 *   agents-tab-playground      components/agents/AgentEditor.tsx (pestaña Playground)
 *   agents-tab-conversations   components/agents/AgentEditor.tsx (pestaña Conversaciones)
 * Sin el botón de crear (no administra) ese paso se saltea. Sin agentes,
 * abrir uno y el editor se saltean. En el teléfono las pestañas se desplazan
 * de costado: las que quedan fuera de la pantalla se saltean.
 */
export const AGENTS_TOUR = {
  key: 'agents',
  startPath: '/app/agents',
  paths: ['/app/agents'],
  steps: [
    { id: 'intro' },
    { id: 'newAgent', targets: ['agents-new'] },
    { id: 'templates', targets: ['agents-template'] },
    { id: 'openAgent', targets: ['agents-item'], advanceOn: 'click' },
    { id: 'configure', targets: ['agents-tabs'] },
    { id: 'playground', targets: ['agents-tab-playground'] },
    { id: 'conversations', targets: ['agents-tab-conversations'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
