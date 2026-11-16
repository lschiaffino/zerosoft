import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-mobile-no-side-scroll',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines on a phone: the chat stays put sideways',
    es: 'Inbox y Lines en el teléfono: el chat ya no se corre de costado',
    pt: 'Inbox e Lines no celular: a conversa não corre mais para os lados',
  },
  items: [
    {
      product: 'inbox',
      en: 'On a phone the conversation has the width of the screen, like WhatsApp. Swiping a message to reply, or dragging sideways over the chat, no longer moves the whole view. Tapping the message box on an iPhone no longer zooms the page in, which left it free to slide sideways.',
      es: 'En el teléfono la conversación tiene el ancho de la pantalla, como WhatsApp. Deslizar un mensaje para responder, o arrastrar de costado sobre el chat, ya no mueve toda la vista. Tocar el campo de mensaje en un iPhone ya no agranda la página, que después quedaba suelta de costado.',
      pt: 'No celular a conversa tem a largura da tela, como no WhatsApp. Deslizar uma mensagem para responder, ou arrastar para o lado sobre a conversa, não move mais a tela inteira. Tocar no campo de mensagem em um iPhone não amplia mais a página, que depois ficava solta para os lados.',
    },
    {
      product: 'groups',
      en: 'Lines gets the same fix: the chat no longer slides sideways, and its search and message fields no longer zoom the page in on an iPhone.',
      es: 'Lines tiene el mismo arreglo: el chat ya no se corre de costado, y el buscador y el campo de mensaje ya no agrandan la página en un iPhone.',
      pt: 'O Lines tem a mesma correção: a conversa não corre mais para os lados, e a busca e o campo de mensagem não ampliam mais a página em um iPhone.',
    },
  ],
} satisfies ChangelogEntry;
