import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-image-editor',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: edit a photo before sending it, like WhatsApp',
    es: 'Inbox y Lines: editá una foto antes de mandarla, como en WhatsApp',
    pt: 'Inbox e Lines: edite uma foto antes de enviar, como no WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'Photos you pick, drop or paste open in the preview with WhatsApp tools: crop and rotate, add an emoji or one of your stickers, write text in a color, and draw with a pencil in several colors and sizes, with undo. The caption has its own emoji button. Photos go in standard quality like WhatsApp; the HD button sends a large photo at full size. Esc closes, Enter sends.',
      es: 'Las fotos que elegís, soltás o pegás se abren en la vista previa con las herramientas de WhatsApp: recortar y rotar, poner un emoji o uno de tus stickers, escribir un texto de color y dibujar con un lápiz de varios colores y grosores, con deshacer. El comentario tiene su botón de emoji. Las fotos salen en calidad estándar como en WhatsApp; el botón HD manda una foto grande en tamaño real. Esc cierra, Enter manda.',
      pt: 'As fotos que você escolhe, solta ou cola abrem na pré-visualização com as ferramentas do WhatsApp: cortar e girar, colocar um emoji ou uma das suas figurinhas, escrever um texto colorido e desenhar com um lápis de várias cores e espessuras, com desfazer. A legenda tem o seu botão de emoji. As fotos vão em qualidade padrão como no WhatsApp; o botão HD envia uma foto grande em tamanho real. Esc fecha, Enter envia.',
    },
    {
      product: 'groups',
      en: 'Lines has the same photo editor and HD button.',
      es: 'Lines tiene el mismo editor de fotos y el botón HD.',
      pt: 'O Lines tem o mesmo editor de fotos e o botão HD.',
    },
  ],
} satisfies ChangelogEntry;
