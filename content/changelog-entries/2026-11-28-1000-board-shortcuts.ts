import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-board-shortcuts',
  date: '2026-11-28',
  title: {
    en: 'Board: a sheet with the keyboard shortcuts of stickies, minimap and presenting',
    es: 'Board: una hoja con los atajos de stickies, minimapa y presentación',
    pt: 'Board: uma folha com os atalhos de stickies, minimapa e apresentação',
  },
  items: [
    {
      product: 'board',
      en: 'The new ? button in the tools at the bottom right of the canvas lists the shortcuts Board adds on top of Excalidraw: N for a new sticky, Tab and Shift+Tab to chain stickies, Alt and the arrow keys to add one in a direction, M for the minimap and the keys to move through slides while presenting. Esc or a click outside closes it.',
      es: 'El botón ? nuevo en las herramientas de abajo a la derecha del lienzo lista los atajos que Board suma sobre Excalidraw: N para un sticky nuevo, Tab y Shift+Tab para encadenar stickies, Alt y las flechas para sumar uno en una dirección, M para el minimapa y las teclas para pasar diapositivas al presentar. Se cierra con Esc o con un clic afuera.',
      pt: 'O novo botão ? nas ferramentas no canto inferior direito da tela lista os atalhos que o Board soma ao Excalidraw: N para um sticky novo, Tab e Shift+Tab para encadear stickies, Alt e as setas para somar um em uma direção, M para o minimapa e as teclas para passar slides ao apresentar. Fecha com Esc ou com um clique fora.',
    },
  ],
} satisfies ChangelogEntry;
