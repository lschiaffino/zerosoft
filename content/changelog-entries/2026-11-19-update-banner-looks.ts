import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-update-banner-looks',
  date: '2026-11-19',
  title: {
    en: 'The "new version" notice follows your chosen look and has its buttons in one row',
    es: 'El aviso de "versión nueva" sigue el aspecto que elegiste y tiene los botones en una fila',
    pt: 'O aviso de "nova versão" segue a aparência escolhida e tem os botões em uma linha',
  },
  items: [
    {
      product: 'platform',
      en: 'The notice that a new version is ready always looked the same: a black border and a heavy shadow, whatever look you had chosen in Settings › Appearance. It now uses the same surface as menus in each look (Lines, Classic, Liquid and Retro). The buttons also moved: they used to sit beside the text with the "See what’s new" link floating in the middle. Now the text is on top and one row below has the link on the left and Reload and Not now on the right.',
      es: 'El aviso de que hay una versión nueva se veía siempre igual: borde negro y sombra pesada, sin importar el aspecto elegido en Ajustes › Apariencia. Ahora usa la misma superficie que los menús en cada aspecto (Líneas, Clásico, Líquido y Retro). También cambió el lugar de los botones: antes iban al costado del texto, con el enlace "Ver novedades" suelto en el medio. Ahora el texto va arriba y debajo hay una fila con el enlace a la izquierda y Recargar y Ahora no a la derecha.',
      pt: 'O aviso de que há uma nova versão era sempre igual: borda preta e sombra pesada, qualquer que fosse a aparência escolhida em Ajustes › Aparência. Agora usa a mesma superfície dos menus em cada aparência (Linhas, Clássico, Líquido e Retrô). Os botões também mudaram de lugar: antes ficavam ao lado do texto, com o link "Ver novidades" solto no meio. Agora o texto fica em cima e, abaixo, uma linha tem o link à esquerda e Recarregar e Agora não à direita.',
    },
  ],
} satisfies ChangelogEntry;
