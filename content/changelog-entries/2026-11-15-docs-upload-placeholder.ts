import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-docs-upload-placeholder',
  date: '2026-11-15',
  title: {
    en: 'Docs and Notes: uploads show up where they will go, with progress and Cancel',
    es: 'Docs y Notes: lo que subís aparece donde va a quedar, con el progreso y Cancelar',
    pt: 'Docs e Notes: o que você envia aparece onde vai ficar, com o progresso e Cancelar',
  },
  items: [
    {
      product: 'docs',
      en: 'While a video, image or file uploads, a gray placeholder takes its place in the page at its final size, with the percentage and a Cancel button. When the upload finishes, the video or image replaces it in the same spot without the page jumping. Before, a line saying "Uploading 1 file..." appeared below the editor, against the left edge of the window.',
      es: 'Mientras sube un video, una imagen o un archivo, un bloque gris ocupa su lugar en la página con el tamaño final, el porcentaje y un botón Cancelar. Al terminar, el video o la imagen lo reemplaza en el mismo lugar sin que la página salte. Antes aparecía una línea "Subiendo 1 archivo..." debajo del editor, pegada al borde izquierdo de la ventana.',
      pt: 'Enquanto um vídeo, uma imagem ou um arquivo é enviado, um bloco cinza ocupa o lugar dele na página com o tamanho final, a porcentagem e um botão Cancelar. Ao terminar, o vídeo ou a imagem o substitui no mesmo lugar sem a página pular. Antes aparecia uma linha "Enviando 1 arquivo..." embaixo do editor, colada na borda esquerda da janela.',
    },
    {
      product: 'docs',
      en: 'Several files at once each get their own placeholder, in order. Pasting and dropping files work the same as the upload button. If an upload fails, the placeholder becomes a message with Retry and Remove.',
      es: 'Varios archivos a la vez tienen cada uno su lugar, en orden. Pegar y soltar archivos funciona igual que el botón de subir. Si una subida falla, el lugar pasa a un aviso con Reintentar y Quitar.',
      pt: 'Vários arquivos de uma vez têm cada um o seu lugar, em ordem. Colar e soltar arquivos funciona igual ao botão de enviar. Se um envio falhar, o lugar vira um aviso com Tentar de novo e Remover.',
    },
    {
      product: 'notes',
      en: 'Notes uploads work the same way.',
      es: 'En Notes las subidas funcionan igual.',
      pt: 'No Notes os envios funcionam igual.',
    },
  ],
} satisfies ChangelogEntry;
