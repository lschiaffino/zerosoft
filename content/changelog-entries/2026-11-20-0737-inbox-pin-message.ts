import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-inbox-pin-message',
  date: '2026-11-20',
  title: {
    en: 'Inbox: pin messages in a WhatsApp chat',
    es: 'Inbox: fijar mensajes en un chat de WhatsApp',
    pt: 'Inbox: fixar mensagens numa conversa do WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'The message menu now has Pin, like WhatsApp and Lines. Up to 3 pinned messages show in a strip at the top of the chat: click one to go to it, even if it is older than what is loaded, or unpin it with the ×. With the current WhatsApp server they stay pinned in Inbox, not on the phone.',
      es: 'El menú del mensaje ahora tiene Fijar, como WhatsApp y Lines. Hasta 3 mensajes fijados se ven en una franja arriba del chat: un clic lleva al mensaje, aunque sea más viejo que lo cargado, y la × lo desfija. Con el servidor de WhatsApp actual quedan fijados en Inbox, no en el teléfono.',
      pt: 'O menu da mensagem agora tem Fixar, como o WhatsApp e o Lines. Até 3 mensagens fixadas aparecem numa faixa no topo da conversa: um clique leva até a mensagem, mesmo que seja mais antiga que o carregado, e o × desafixa. Com o servidor de WhatsApp atual ficam fixadas no Inbox, não no celular.',
    },
  ],
} satisfies ChangelogEntry;
