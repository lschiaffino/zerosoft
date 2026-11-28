import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-wa-mentions-tabs-qa',
  date: '2026-11-28',
  title: {
    en: 'Lines and Inbox: the @ list without your own number, and chat panel tabs that read in full',
    es: 'Lines e Inbox: la lista del @ sin tu propio número, y las pestañas del panel del chat enteras',
    pt: 'Lines e Inbox: a lista do @ sem o seu próprio número, e as abas do painel da conversa inteiras',
  },
  items: [
    {
      product: 'groups',
      en: 'In a group, the list that opens with @ no longer offers the number of the line itself, as WhatsApp does not let you mention yourself. Numbers in that list now show in the WhatsApp format (+1 555 000 0000), also in photo and document captions. The tabs of the chat panel take the width of their name, so Members is no longer cut on a phone or with the panel next to the chat.',
      es: 'En un grupo, la lista que se abre con @ ya no ofrece el número de la propia línea, porque WhatsApp no deja mencionarse a uno mismo. Los números de esa lista se ven con el formato de WhatsApp (+54 9 11 5555-0000), también en el pie de fotos y documentos. Las pestañas del panel del chat toman el ancho de su nombre, así Miembros ya no queda cortado en el teléfono o con el panel al lado del chat.',
      pt: 'Em um grupo, a lista que abre com @ não oferece mais o número da própria linha, porque o WhatsApp não deixa mencionar a si mesmo. Os números dessa lista aparecem no formato do WhatsApp (+55 11 91234-5678), também na legenda de fotos e documentos. As abas do painel da conversa ocupam a largura do nome, então Membros não fica mais cortado no celular ou com o painel ao lado da conversa.',
    },
    {
      product: 'inbox',
      en: 'In a WhatsApp group, numbers in the @ list show in the WhatsApp format (+1 555 000 0000), also in photo and document captions.',
      es: 'En un grupo de WhatsApp, los números de la lista del @ se ven con el formato de WhatsApp (+54 9 11 5555-0000), también en el pie de fotos y documentos.',
      pt: 'Em um grupo do WhatsApp, os números da lista do @ aparecem no formato do WhatsApp (+55 11 91234-5678), também na legenda de fotos e documentos.',
    },
  ],
} satisfies ChangelogEntry;
