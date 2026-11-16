import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-link-big',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: link previews with the big image WhatsApp sends',
    es: 'Inbox y Lines: vistas previas de links con la imagen grande que manda WhatsApp',
    pt: 'Inbox e Lines: prévias de links com a imagem grande que o WhatsApp envia',
  },
  items: [
    {
      product: 'inbox',
      en: 'A link to a Google Maps place or an article with a good photo now shows the big card, as in WhatsApp: the photo at full width, the title, the description and the site. The image is the one the sender’s phone attached to the message, downloaded once and kept with the message; when there is none, we read the page as before. Very long links break inside the bubble instead of running past it.',
      es: 'Un link a un lugar de Google Maps o a una nota con una buena foto ahora muestra la tarjeta grande, como en WhatsApp: la foto a todo el ancho, el título, la descripción y el sitio. La imagen es la que el teléfono de quien lo mandó adjuntó al mensaje, bajada una vez y guardada con el mensaje; si no viene, se lee la página como antes. Los links muy largos se cortan dentro de la burbuja en vez de salirse.',
      pt: 'Um link para um lugar do Google Maps ou uma matéria com uma boa foto agora mostra o cartão grande, como no WhatsApp: a foto em largura total, o título, a descrição e o site. A imagem é a que o celular de quem enviou anexou à mensagem, baixada uma vez e guardada com a mensagem; se não vier, a página é lida como antes. Links muito longos quebram dentro do balão em vez de sair dele.',
    },
    {
      product: 'groups',
      en: 'The same in Lines, which now also uses the preview WhatsApp sends with the message.',
      es: 'Lo mismo en Lines, que ahora también usa la vista previa que manda WhatsApp con el mensaje.',
      pt: 'O mesmo no Lines, que agora também usa a prévia que o WhatsApp envia com a mensagem.',
    },
  ],
} satisfies ChangelogEntry;
