import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-media-width',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: a photo that could not load keeps its width',
    es: 'Inbox y Lines: una foto que no cargó mantiene su ancho',
    pt: 'Inbox e Lines: uma foto que não carregou mantém a largura',
  },
  items: [
    {
      product: 'inbox',
      en: 'When a photo or video with a long caption could not be downloaded, the bubble shrank to the width of the "Not available" note and the caption ran one or two words per line. The missing photo now keeps the space of the photo (or a standard one), with the blurred preview when WhatsApp sent it, and the caption reads at normal width, as in WhatsApp. Phone photos also show at full width.',
      es: 'Cuando una foto o un video con un texto largo no se podía bajar, la burbuja quedaba del ancho del aviso "No disponible" y el texto salía de a una o dos palabras por renglón. Ahora la foto que falta ocupa el lugar de la foto (o uno estándar), con la miniatura borrosa si WhatsApp la mandó, y el texto se lee a ancho normal, como en WhatsApp. Las fotos verticales de teléfono también se ven a ancho entero.',
      pt: 'Quando uma foto ou vídeo com legenda longa não podia ser baixado, o balão ficava da largura do aviso "Indisponível" e a legenda saía com uma ou duas palavras por linha. Agora a foto que falta ocupa o espaço da foto (ou um padrão), com a miniatura desfocada quando o WhatsApp a envia, e a legenda fica com largura normal, como no WhatsApp. Fotos verticais de celular também aparecem com largura total.',
    },
    {
      product: 'groups',
      en: 'The same fix applies in Lines.',
      es: 'Lo mismo en Lines.',
      pt: 'O mesmo vale para o Lines.',
    },
  ],
} satisfies ChangelogEntry;
