import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-folder-menu-whole',
  date: '2026-11-19',
  title: {
    en: 'Lines: the folder menu is no longer cut off',
    es: 'Lines: el menú de una carpeta ya no queda cortado',
    pt: 'Lines: o menu de uma pasta não fica mais cortado',
  },
  items: [
    {
      product: 'groups',
      en: 'The three-dot menu of a folder in the sidebar opened inside the sidebar, so its right half was hidden and its options sat on top of the items below. It now opens next to its button, whole, and moves up or sideways when it would not fit in the window. It closes with Esc, with a click outside and when the page scrolls.',
      es: 'El menú de tres puntos de una carpeta en la barra lateral se abría dentro de la barra, así que la mitad derecha quedaba oculta y las opciones se encimaban con lo de abajo. Ahora se abre junto a su botón, entero, y se corre hacia arriba o al costado cuando no entra en la ventana. Se cierra con Esc, con un clic afuera y al mover la página.',
      pt: 'O menu de três pontos de uma pasta na barra lateral abria dentro da barra, então a metade direita ficava escondida e as opções ficavam em cima do que estava abaixo. Agora ele abre ao lado do botão, inteiro, e sobe ou vai para o lado quando não cabe na janela. Fecha com Esc, com um clique fora e ao rolar a página.',
    },
  ],
} satisfies ChangelogEntry;
