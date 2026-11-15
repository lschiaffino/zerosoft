import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-screen-black',
  date: '2026-11-15',
  title: {
    en: 'Rec: screen recordings no longer come out black',
    es: 'Rec: las grabaciones de pantalla ya no salen negras',
    pt: 'Rec: as gravações de tela não saem mais pretas',
  },
  items: [
    {
      product: 'rec',
      en: 'Recording starts once the screen has sent its first picture, and screen and camera are drawn on an opaque background from the first frame. Before, the first frame of the file could be empty, and in Safari and the desktop app the parts of the screen that did not move stayed black until the next keyframe. If the screen sends no picture at all, which is what a Mac does without the Screen Recording permission, Rec now says so before recording instead of saving a black video. If the screen turns black while you record, a warning shows up right away.',
      es: 'La grabación arranca cuando la pantalla ya mandó su primera imagen, y pantalla y cámara se dibujan sobre un fondo opaco desde el primer cuadro. Antes el primer cuadro del archivo podía salir vacío, y en Safari y en la app de escritorio las partes de la pantalla que no se movían quedaban negras hasta el siguiente keyframe. Si la pantalla no manda ninguna imagen, que es lo que hace una Mac sin el permiso de Grabación de pantalla, Rec ahora lo avisa antes de grabar en vez de guardar un video negro. Si la pantalla se pone negra mientras grabás, aparece un aviso en el momento.',
      pt: 'A gravação começa quando a tela já enviou a primeira imagem, e tela e câmera são desenhadas sobre um fundo opaco desde o primeiro quadro. Antes o primeiro quadro do arquivo podia sair vazio, e no Safari e no app para desktop as partes da tela que não se mexiam ficavam pretas até o próximo keyframe. Se a tela não envia nenhuma imagem, que é o que um Mac faz sem a permissão de Gravação de tela, o Rec agora avisa antes de gravar em vez de salvar um vídeo preto. Se a tela ficar preta enquanto você grava, aparece um aviso na hora.',
    },
  ],
} satisfies ChangelogEntry;
