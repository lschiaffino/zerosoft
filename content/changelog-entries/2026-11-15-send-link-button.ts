import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-send-link-button',
  date: '2026-11-15',
  title: {
    en: 'Send: a button of your own in the viewer',
    es: 'Send: un botón propio en el visor',
    pt: 'Send: um botão próprio no visor',
  },
  items: [
    {
      product: 'send',
      en: 'Each link can show a button with your text and a web address, for example "Book a call" to your booking page. It sits in the viewer bar on a computer and at the bottom of the screen on a phone, in your brand color, and opens in a new tab. In a space it shows above the document list too. Clicks appear in the document numbers, per button and per visit, and the link filter now also applies to clicks on links inside the document.',
      es: 'Cada link puede mostrar un botón con tu texto y una dirección web, por ejemplo "Agendar una llamada" a tu página de reservas. Va en la barra del visor en la computadora y abajo de la pantalla en el teléfono, con el color de tu marca, y abre en otra pestaña. En un espacio también aparece arriba de la lista de documentos. Los clics aparecen en los números del documento, por botón y por visita, y el filtro por link ahora también se aplica a los clics en links dentro del documento.',
      pt: 'Cada link pode mostrar um botão com o seu texto e um endereço web, por exemplo "Agendar uma conversa" para a sua página de agendamento. Ele fica na barra do visor no computador e embaixo da tela no celular, na cor da sua marca, e abre em outra aba. Em um espaço também aparece acima da lista de documentos. Os cliques aparecem nos números do documento, por botão e por visita, e o filtro por link agora também vale para os cliques em links dentro do documento.',
    },
  ],
} satisfies ChangelogEntry;
