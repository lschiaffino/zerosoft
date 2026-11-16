import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-calm-focus-inbox-lines',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: no stray boxes around folders and chats',
    es: 'Inbox y Lines: sin recuadros sueltos alrededor de carpetas y chats',
    pt: 'Inbox e Lines: sem caixas soltas em volta de pastas e conversas',
  },
  items: [
    {
      product: 'inbox',
      en: 'After clicking a folder, a chat or a tab, pressing a key (j, k, the arrows, a shortcut) drew a thick black box around the last thing you clicked. Now a click never leaves a box: the folder and the chat you are in show a background, the keyboard cursor in the list is a soft row highlight, and a thin gray ring appears only when you move with Tab. The message field and the search keep their border.',
      es: 'Después de hacer clic en una carpeta, un chat o una pestaña, cualquier tecla (j, k, las flechas, un atajo) dibujaba un recuadro negro grueso alrededor de lo último que habías tocado. Ahora un clic nunca deja un recuadro: la carpeta y el chat en los que estás se ven con un fondo, el cursor del teclado en la lista es un resaltado suave de la fila, y un anillo gris fino aparece solo cuando te movés con Tab. El campo del mensaje y la búsqueda conservan su borde.',
      pt: 'Depois de clicar numa pasta, numa conversa ou numa aba, qualquer tecla (j, k, as setas, um atalho) desenhava uma caixa preta grossa em volta da última coisa clicada. Agora um clique nunca deixa uma caixa: a pasta e a conversa em que você está aparecem com um fundo, o cursor do teclado na lista é um destaque suave da linha, e um anel cinza fino aparece só quando você se move com Tab. O campo da mensagem e a busca mantêm a borda.',
    },
    {
      product: 'groups',
      en: 'The same in Lines, including the folders in the sidebar, the chat list, the filters and the buttons around the message field.',
      es: 'Lo mismo en Lines, con las carpetas del sidebar, la lista de chats, los filtros y los botones alrededor del campo del mensaje.',
      pt: 'O mesmo no Lines, com as pastas da barra lateral, a lista de conversas, os filtros e os botões em volta do campo da mensagem.',
    },
  ],
} satisfies ChangelogEntry;
