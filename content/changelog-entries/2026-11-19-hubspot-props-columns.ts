import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-hubspot-props-columns',
  date: '2026-11-19',
  title: {
    en: 'Lines and Inbox: HubSpot values no longer shrink to one letter',
    es: 'Lines e Inbox: los valores de HubSpot ya no quedan de una letra de ancho',
    pt: 'Lines e Inbox: os valores do HubSpot não ficam mais com uma letra de largura',
  },
  items: [
    {
      product: 'groups',
      en: 'In the HubSpot card next to a chat, a long property name (common with custom properties) took the whole width, and every value was written one letter per line. Names now take at most about half of the card and wrap, so values keep room to read.',
      es: 'En la tarjeta de HubSpot al lado de un chat, un nombre de propiedad largo (común en las propiedades personalizadas) se quedaba con todo el ancho, y cada valor se escribía una letra por renglón. Ahora los nombres ocupan como mucho la mitad de la tarjeta y bajan de renglón, así los valores tienen lugar para leerse.',
      pt: 'No cartão do HubSpot ao lado de uma conversa, um nome de propriedade longo (comum nas propriedades personalizadas) ocupava toda a largura, e cada valor era escrito uma letra por linha. Agora os nomes ocupam no máximo cerca de metade do cartão e quebram a linha, então os valores têm espaço para serem lidos.',
    },
  ],
} satisfies ChangelogEntry;
