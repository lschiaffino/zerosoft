import type { ChangelogEntry } from '../changelog';

const en =
  'Link cards in chats now look like the ones in WhatsApp. The card fills the width of the bubble and the message text wraps below it, so the card is never narrower than the text. The title is bold and not underlined, the description takes two lines at most, and the site name sits in small grey text. A wide image goes on top, a small one goes on the left as a square thumbnail, and a card with only a title stays compact. When a page has no og:image, the card now uses its twitter:image or other image tags, tries the next image if one cannot be downloaded, and accepts larger cover images. Cards that were saved without an image are read again once.';
const es =
  'Las tarjetas de los links en los chats ahora se ven como las de WhatsApp. La tarjeta ocupa el ancho de la burbuja y el texto del mensaje se acomoda abajo, así que nunca queda más angosta que el texto. El título va en negrita y sin subrayar, la descripción ocupa dos líneas como mucho y el nombre del sitio va chico y en gris. Una imagen ancha va arriba, una chica va a la izquierda como miniatura cuadrada, y una tarjeta con solo el título queda compacta. Si una página no tiene og:image, la tarjeta usa su twitter:image u otras etiquetas de imagen, prueba la siguiente imagen si una no se puede bajar y acepta portadas más pesadas. Las tarjetas que habían quedado sin imagen se vuelven a leer una vez.';
const pt =
  'Os cartões dos links nos chats agora ficam como os do WhatsApp. O cartão ocupa a largura do balão e o texto da mensagem se ajeita embaixo, então ele nunca fica mais estreito que o texto. O título fica em negrito e sem sublinhado, a descrição ocupa no máximo duas linhas e o nome do site fica pequeno e em cinza. Uma imagem larga vai em cima, uma pequena vai à esquerda como miniatura quadrada, e um cartão só com o título fica compacto. Se uma página não tem og:image, o cartão usa a twitter:image ou outras tags de imagem, tenta a imagem seguinte se uma não puder ser baixada e aceita capas mais pesadas. Os cartões que tinham ficado sem imagem são lidos de novo uma vez.';

export default {
  id: '2026-11-20-wa-link-card-polish',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: link cards fill the bubble, like in WhatsApp',
    es: 'Lines e Inbox: las tarjetas de los links ocupan la burbuja, como en WhatsApp',
    pt: 'Lines e Inbox: os cartões dos links ocupam o balão, como no WhatsApp',
  },
  items: [
    { product: 'groups', en, es, pt },
    { product: 'inbox', en, es, pt },
  ],
} satisfies ChangelogEntry;
