import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-docs-calm-focus-button',
  date: '2026-11-15',
  title: {
    en: 'Docs and Notes: no box around the line you type in, a comment icon you can reach, and a button you can delete',
    es: 'Docs y Notes: sin caja alrededor de la línea en la que escribís, un ícono de comentar que se alcanza y un botón que se puede borrar',
    pt: 'Docs e Notes: sem caixa em volta da linha em que você digita, um ícone de comentar que dá para alcançar e um botão que dá para apagar',
  },
  items: [
    {
      product: 'docs',
      en: 'The title and the paragraph you are typing in no longer get a thick black rectangle around them: the caret is enough, as in Notion. Buttons and handles still show a focus ring when you use the keyboard, and a selected image, video or card gets a light blue ring.',
      es: 'El título y el párrafo en el que escribís ya no llevan un rectángulo negro grueso alrededor: alcanza con el cursor, como en Notion. Los botones y las asas siguen mostrando el foco cuando usás el teclado, y una imagen, un video o una tarjeta seleccionados llevan un anillo azul suave.',
      pt: 'O título e o parágrafo em que você digita não ganham mais um retângulo preto grosso em volta: o cursor basta, como no Notion. Botões e alças continuam mostrando o foco quando você usa o teclado, e uma imagem, um vídeo ou um cartão selecionados ganham um anel azul suave.',
    },
    {
      product: 'docs',
      en: 'The comment icon to the right of a block stayed visible only while the mouse was over the block, so it disappeared on the way to it. It now stays while you move to it (and to the drag handle on the left), and clicking it opens a comment on that block.',
      es: 'El ícono de comentar a la derecha de un bloque se veía solo con el mouse sobre el bloque y desaparecía en el camino. Ahora queda mientras vas hacia él (y hacia el asa de la izquierda), y al hacer click abre un comentario sobre ese bloque.',
      pt: 'O ícone de comentar à direita de um bloco só aparecia com o mouse sobre o bloco e sumia no caminho. Agora fica enquanto você vai até ele (e até a alça da esquerda), e o clique abre um comentário sobre esse bloco.',
    },
    {
      product: 'docs',
      en: 'Button blocks can be deleted from their settings, with Backspace or Delete when selected, and from the handle menu even when they are the only block. Undo brings them back. The blocks a button inserts now read [] and [x] as to-dos, and the settings list the shortcuts you can use.',
      es: 'Los bloques botón se pueden borrar desde su configuración, con Backspace o Supr cuando están seleccionados y desde el menú del asa, aunque sean el único bloque. Deshacer los trae de vuelta. Lo que inserta un botón ahora toma [] y [x] como tareas, y la configuración muestra los atajos que acepta.',
      pt: 'Blocos de botão podem ser apagados nas configurações, com Backspace ou Delete quando selecionados e pelo menu da alça, mesmo quando são o único bloco. Desfazer traz de volta. O que um botão insere agora lê [] e [x] como tarefas, e as configurações mostram os atalhos aceitos.',
    },
    {
      product: 'notes',
      en: 'The note editor gets the same focus and button fixes.',
      es: 'El editor de notas recibe los mismos arreglos de foco y del botón.',
      pt: 'O editor de notas recebe as mesmas correções de foco e do botão.',
    },
  ],
} satisfies ChangelogEntry;
