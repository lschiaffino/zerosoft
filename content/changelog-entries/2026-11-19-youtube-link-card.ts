import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-youtube-link-card',
  date: '2026-11-19',
  title: {
    en: 'Inbox and Lines: YouTube links show their card again',
    es: 'Inbox y Lines: los links de YouTube vuelven a mostrar su tarjeta',
    pt: 'Inbox e Lines: os links do YouTube voltam a mostrar o cartão',
  },
  items: [
    {
      product: 'inbox',
      en: 'A message with a YouTube link showed only the link, with no thumbnail or title, while WhatsApp showed the full card. YouTube does not give our server the page it gives a person, so there was nothing to build the card from. Video links (watch, youtu.be, Shorts, live) now get their title, channel and thumbnail from the service YouTube offers for this. Cards that were saved empty are read again.',
      es: 'Un mensaje con un link de YouTube mostraba solo el link, sin miniatura ni título, mientras WhatsApp mostraba la tarjeta entera. YouTube no le da a nuestro servidor la página que le da a una persona, así que no había con qué armar la tarjeta. Los links de video (watch, youtu.be, Shorts, en vivo) ahora toman el título, el canal y la miniatura del servicio que YouTube ofrece para eso. Las tarjetas que habían quedado vacías se vuelven a leer.',
      pt: 'Uma mensagem com um link do YouTube mostrava só o link, sem miniatura nem título, enquanto o WhatsApp mostrava o cartão inteiro. O YouTube não entrega ao nosso servidor a página que entrega a uma pessoa, então não havia com o que montar o cartão. Os links de vídeo (watch, youtu.be, Shorts, ao vivo) agora pegam o título, o canal e a miniatura do serviço que o YouTube oferece para isso. Os cartões que tinham ficado vazios são lidos de novo.',
    },
  ],
} satisfies ChangelogEntry;
