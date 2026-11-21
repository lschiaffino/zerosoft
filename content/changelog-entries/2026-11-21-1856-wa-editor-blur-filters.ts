import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-1856-wa-editor-blur-filters',
  date: '2026-11-21',
  title: {
    en: 'Blur and color filters in the photo editor',
    es: 'Desenfocar y filtros de color en el editor de fotos',
    pt: 'Desfoque e filtros de cor no editor de fotos',
  },
  items: [
    {
      product: 'groups',
      en: 'The photo editor in the file preview has two new tools, like WhatsApp: a blur brush (three sizes) to hide a face, a plate or a phone number, and color filters (Pop, B&W, Cool, Chrome and Film) with a preview of each one. Undo takes back each step, and the photo goes out with the changes.',
      es: 'El editor de fotos de la vista previa tiene dos herramientas nuevas, como WhatsApp: un pincel para desenfocar (tres grosores) y tapar una cara, una patente o un teléfono, y filtros de color (Pop, B&N, Frío, Cromo y Película) con una muestra de cada uno. Deshacer vuelve cada paso, y la foto sale con los cambios.',
      pt: 'O editor de fotos da prévia tem duas ferramentas novas, como no WhatsApp: um pincel de desfoque (três espessuras) para esconder um rosto, uma placa ou um telefone, e filtros de cor (Pop, P&B, Frio, Cromo e Filme) com uma amostra de cada um. Desfazer volta cada passo, e a foto sai com as mudanças.',
    },
    {
      product: 'inbox',
      en: 'The same blur brush and color filters in the Inbox photo editor.',
      es: 'El mismo pincel para desenfocar y los filtros de color en el editor de fotos de Inbox.',
      pt: 'O mesmo pincel de desfoque e os filtros de cor no editor de fotos do Inbox.',
    },
  ],
} satisfies ChangelogEntry;
