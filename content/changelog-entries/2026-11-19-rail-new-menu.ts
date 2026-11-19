import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-rail-new-menu',
  date: '2026-11-19',
  title: {
    en: 'The New menu opens next to the collapsed sidebar',
    es: 'El menú Nuevo se abre al lado de la barra lateral colapsada',
    pt: 'O menu Novo abre ao lado da barra lateral recolhida',
  },
  items: [
    {
      product: 'platform',
      en: 'With the sidebar collapsed (as Notes starts), the + button opened its menu inside the narrow bar: the options were cut off and the bar slid out of view. Now the menu opens next to the bar, whole, and Esc closes it.',
      es: 'Con la barra lateral colapsada (como arranca Notes), el botón + abría su menú adentro de la barra angosta: las opciones quedaban cortadas y la barra se corría fuera de la pantalla. Ahora el menú se abre al lado de la barra, entero, y Esc lo cierra.',
      pt: 'Com a barra lateral recolhida (como o Notes começa), o botão + abria o menu dentro da barra estreita: as opções ficavam cortadas e a barra saía da tela. Agora o menu abre ao lado da barra, inteiro, e Esc fecha.',
    },
  ],
} satisfies ChangelogEntry;
