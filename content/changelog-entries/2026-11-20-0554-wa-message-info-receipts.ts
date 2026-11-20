import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-wa-message-info-receipts',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: Message info shows who read it, with the time',
    es: 'Inbox y Lines: la Info del mensaje muestra quién lo leyó, con la hora',
    pt: 'Inbox e Lines: os Dados da mensagem mostram quem leu, com o horário',
  },
  items: [
    {
      product: 'inbox',
      en: 'Message info on a message you sent opens next to the message, like on WhatsApp, instead of a window in the middle. In a one to one chat it shows when it was delivered and when it was read. In a group it lists Read by and Delivered to, with each person\'s photo, name and time, seven at a time with a button for the rest, once the line\'s WhatsApp server reports it. On a phone it opens from the bottom. Esc or a click outside closes it.',
      es: 'La Info de un mensaje que mandaste se abre al lado del mensaje, como en WhatsApp, en vez de una ventana en el medio. En un chat individual muestra cuándo se entregó y cuándo se leyó. En un grupo lista Leído por y Entregado a, con la foto, el nombre y la hora de cada persona, de a siete con un botón para el resto, cuando el servidor de WhatsApp de la línea lo informa. En el teléfono se abre desde abajo. Esc o un clic afuera la cierran.',
      pt: 'Os Dados de uma mensagem que você enviou abrem ao lado da mensagem, como no WhatsApp, em vez de uma janela no meio. Numa conversa individual mostram quando foi entregue e quando foi lida. Num grupo listam Lida por e Entregue a, com a foto, o nome e o horário de cada pessoa, de sete em sete com um botão para o resto, quando o servidor de WhatsApp da linha informa. No celular abrem de baixo. Esc ou um clique fora fecham.',
    },
    {
      product: 'groups',
      en: 'The same Message info in Lines. People who can\'t see phone numbers see them hidden here too, and only people who can see the line can open it.',
      es: 'La misma Info del mensaje en Lines. Quien no ve teléfonos los ve ocultos también acá, y solo quien ve la línea puede abrirla.',
      pt: 'Os mesmos Dados da mensagem no Lines. Quem não vê telefones também os vê ocultos aqui, e só quem vê a linha pode abri-los.',
    },
  ],
} satisfies ChangelogEntry;
