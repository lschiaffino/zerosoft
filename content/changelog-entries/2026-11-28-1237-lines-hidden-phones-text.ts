import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-lines-hidden-phones-text',
  date: '2026-11-28',
  title: {
    en: 'Lines and Inbox: hidden phone numbers stay hidden in more places',
    es: 'Lines e Inbox: los teléfonos ocultos siguen ocultos en más lugares',
    pt: 'Lines e Inbox: os telefones ocultos continuam ocultos em mais lugares',
  },
  items: [
    {
      product: 'groups',
      en: 'If your workspace hides phone numbers from your role, they are now also hidden in what the team writes: task titles and notes, tickets, internal notes, comments, scheduled and recurring messages, broadcasts and their reminders. Editing one of those texts keeps the numbers you can\'t see. A chat that is on several lines no longer shows a line\'s number to people who don\'t see numbers, and the assistant finds Lines chats only by the names you can see.',
      es: 'Si tu workspace le oculta los teléfonos a tu rol, ahora también quedan ocultos en lo que escribe el equipo: títulos y notas de tareas, tickets, notas internas, comentarios, mensajes programados y recurrentes, envíos y sus avisos. Si editás uno de esos textos, los números que no ves se conservan. Un chat que está en varias líneas ya no muestra el número de una línea a quien no ve teléfonos, y el asistente encuentra los chats de Lines solo por los nombres que ves.',
      pt: 'Se o seu workspace oculta os telefones da sua função, agora eles também ficam ocultos no que a equipe escreve: títulos e notas de tarefas, tickets, notas internas, comentários, mensagens programadas e recorrentes, envios e os seus avisos. Ao editar um desses textos, os números que você não vê são mantidos. Uma conversa que está em várias linhas não mostra mais o número de uma linha para quem não vê telefones, e o assistente encontra as conversas do Lines só pelos nomes que você vê.',
    },
    {
      product: 'inbox',
      en: 'The "No connection" notice in an open chat goes away by itself once the chat loads again.',
      es: 'El aviso "Sin conexión" de un chat abierto se va solo apenas el chat vuelve a cargar.',
      pt: 'O aviso "Sem conexão" de uma conversa aberta some sozinho assim que a conversa carrega de novo.',
    },
  ],
} satisfies ChangelogEntry;
