import type { ChangelogEntry } from '../changelog';

const en =
  'A received video showed the tiny cover WhatsApp sends, stretched and blurry, in a box with black bands above and below. Now the bubble shows the first frame of the video, sharp, at the video\'s real proportions and edge to edge, with the play button in the middle and a camera icon with the length at the bottom left, like WhatsApp. The blurry cover only holds the place until the frame is drawn. The browser asks only for the start of the file, and only for videos near the screen, so long chats stay light. Videos in albums do the same.';
const es =
  'Un video recibido mostraba la portada chiquita que manda WhatsApp, estirada y borrosa, en una caja con bandas negras arriba y abajo. Ahora la burbuja muestra el primer cuadro del video, nítido, con la proporción real del video y de borde a borde, con el botón de reproducir al centro y una cámara con la duración abajo a la izquierda, como WhatsApp. La portada borrosa solo ocupa el lugar hasta que se dibuja el cuadro. El navegador pide solo el principio del archivo, y solo de los videos cerca de la pantalla: los chats largos siguen livianos. Los videos de los álbumes, igual.';
const pt =
  'Um vídeo recebido mostrava a capa pequena que o WhatsApp manda, esticada e borrada, numa caixa com faixas pretas em cima e embaixo. Agora o balão mostra o primeiro quadro do vídeo, nítido, na proporção real do vídeo e de borda a borda, com o botão de reproduzir no centro e uma câmera com a duração embaixo à esquerda, como no WhatsApp. A capa borrada só ocupa o lugar até o quadro aparecer. O navegador pede só o começo do arquivo, e só dos vídeos perto da tela: as conversas longas continuam leves. Os vídeos dos álbuns, igual.';

export default {
  id: '2026-11-20-0528-wa-video-poster',
  date: '2026-11-20',
  title: {
    en: 'Videos in chats show a sharp first frame at their real size',
    es: 'Los videos en los chats muestran un primer cuadro nítido y de su tamaño real',
    pt: 'Os vídeos nas conversas mostram um primeiro quadro nítido e no tamanho real',
  },
  items: [
    { product: 'inbox', en, es, pt },
    { product: 'groups', en, es, pt },
  ],
} satisfies ChangelogEntry;
