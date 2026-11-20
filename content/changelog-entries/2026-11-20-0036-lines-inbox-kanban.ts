import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0036-lines-inbox-kanban',
  date: '2026-11-20',
  title: {
    en: 'Lines: the inbox as a kanban board',
    es: 'Lines: la bandeja como tablero kanban',
    pt: 'Lines: a caixa como quadro kanban',
  },
  items: [
    {
      product: 'groups',
      en: 'A small button next to the line selector at the top of the Lines inbox turns it into a kanban board: each chat is a card, grouped in columns. Pick the columns in the board header: team stages that an admin defines for the workspace, your own stages that nobody else sees, or the options of a HubSpot company property (chats without a linked company or a value go to No value). Drag a card, or use Move to on the card, to change its column; on a HubSpot board that writes the property to HubSpot. Search, the filter tabs, the Filters panel, folders, lines and Archived work on the board too. Each person keeps their own view, board and collapsed columns.',
      es: 'Un botón chico junto al selector de línea, arriba en la bandeja de Lines, la convierte en un tablero kanban: cada chat es una tarjeta, agrupada en columnas. Las columnas se eligen en la cabecera del tablero: etapas del equipo que define un admin para el workspace, tus propias etapas que nadie más ve, o las opciones de una propiedad de la empresa de HubSpot (los chats sin empresa vinculada o sin valor van a Sin valor). Arrastrá una tarjeta, o usá Mover a en la tarjeta, para cambiarla de columna; en un tablero de HubSpot eso escribe la propiedad en HubSpot. La búsqueda, las pestañas de filtros, el panel de Filtros, las carpetas, las líneas y Archivados también valen en el tablero. Cada persona guarda su vista, su tablero y sus columnas plegadas.',
      pt: 'Um botão pequeno ao lado do seletor de linha, no topo da caixa do Lines, a transforma em um quadro kanban: cada conversa é um cartão, agrupado em colunas. As colunas são escolhidas no cabeçalho do quadro: etapas da equipe que um admin define para o workspace, suas próprias etapas que ninguém mais vê, ou as opções de uma propriedade da empresa no HubSpot (conversas sem empresa vinculada ou sem valor vão para Sem valor). Arraste um cartão, ou use Mover para no cartão, para mudar de coluna; em um quadro do HubSpot isso grava a propriedade no HubSpot. A busca, as abas de filtros, o painel de Filtros, as pastas, as linhas e Arquivadas também valem no quadro. Cada pessoa guarda sua visualização, seu quadro e suas colunas recolhidas.',
    },
  ],
} satisfies ChangelogEntry;
