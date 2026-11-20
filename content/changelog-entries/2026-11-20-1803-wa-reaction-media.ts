import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-wa-reaction-media',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: reactions on photos sit on the bubble edge',
    es: 'Lines e Inbox: las reacciones de una foto se apoyan en el borde de la burbuja',
    pt: 'Lines e Inbox: as reações de uma foto ficam na borda do balão',
  },
  items: [
    {
      product: 'groups',
      en: 'A reaction on a photo or video hung below the corner of the image, away from the message. Now the photo keeps a thin bubble frame, as in WhatsApp, and the reaction sits on the bottom edge of the bubble, half inside and half outside, on the side of whoever sent it.',
      es: 'Una reacción sobre una foto o un video quedaba colgando debajo de la esquina de la imagen, separada del mensaje. Ahora la foto conserva un marco fino de burbuja, como en WhatsApp, y la reacción se apoya en el borde de abajo de la burbuja, mitad adentro y mitad afuera, del lado de quien lo mandó.',
      pt: 'Uma reação em uma foto ou vídeo ficava pendurada abaixo do canto da imagem, longe da mensagem. Agora a foto mantém uma moldura fina de balão, como no WhatsApp, e a reação fica na borda de baixo do balão, metade dentro e metade fora, do lado de quem enviou.',
    },
  ],
} satisfies ChangelogEntry;
