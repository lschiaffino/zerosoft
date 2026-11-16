import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-docs-format-toolbar-fit',
  date: '2026-11-15',
  title: {
    en: 'Docs and Notes: the format toolbar stays inside the editor',
    es: 'Docs y Notes: la barra de formato queda adentro del editor',
    pt: 'Docs e Notes: a barra de formatação fica dentro do editor',
  },
  items: [
    {
      product: 'docs',
      en: 'The toolbar that appears over selected text was cut off at the left edge on a phone and covered the sidebar on a computer when the selection was near the start of a line. It now stays inside the editor, sits above the selection without covering it, and hides when the selection scrolls out of view. The link box opens where the toolbar was.',
      es: 'La barra que aparece sobre el texto seleccionado se cortaba contra el borde izquierdo en el teléfono y tapaba el sidebar en la computadora cuando la selección estaba al principio de un renglón. Ahora queda adentro del editor, arriba de la selección sin taparla, y se esconde cuando la selección sale de la vista al hacer scroll. La caja del link se abre donde estaba la barra.',
      pt: 'A barra que aparece sobre o texto selecionado ficava cortada na borda esquerda no celular e cobria a barra lateral no computador quando a seleção estava no começo de uma linha. Agora fica dentro do editor, acima da seleção sem cobri-la, e some quando a seleção sai da vista ao rolar. A caixa do link abre onde a barra estava.',
    },
    {
      product: 'notes',
      en: 'The same fix applies to the note editor.',
      es: 'El mismo arreglo vale para el editor de notas.',
      pt: 'A mesma correção vale para o editor de notas.',
    },
  ],
} satisfies ChangelogEntry;
