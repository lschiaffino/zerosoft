import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-media-quote',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: replies on photos show the quote properly',
    es: 'Inbox y Lines: las respuestas con foto muestran bien la cita',
    pt: 'Inbox e Lines: respostas com foto mostram bem a citação',
  },
  items: [
    {
      product: 'inbox',
      en: 'When a photo or video replied to another message, the quote above it was squeezed to a sliver and the name showed one letter per line. The quote now takes the width of the photo, as in WhatsApp.',
      es: 'Cuando una foto o un video respondía a otro mensaje, la cita de arriba quedaba finita y el nombre salía con una letra por renglón. Ahora la cita ocupa el ancho de la foto, como en WhatsApp.',
      pt: 'Quando uma foto ou vídeo respondia a outra mensagem, a citação acima ficava espremida e o nome aparecia uma letra por linha. Agora a citação ocupa a largura da foto, como no WhatsApp.',
    },
    {
      product: 'groups',
      en: 'The same fix applies in Lines.',
      es: 'Lo mismo en Lines.',
      pt: 'O mesmo vale para o Lines.',
    },
  ],
} satisfies ChangelogEntry;
