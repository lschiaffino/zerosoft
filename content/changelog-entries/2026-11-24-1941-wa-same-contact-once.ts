import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-24-wa-same-contact-once',
  date: '2026-11-24',
  title: {
    en: 'The same contact no longer shows up twice in the list',
    es: 'Un mismo contacto ya no aparece dos veces en la lista',
    pt: 'O mesmo contato não aparece mais duas vezes na lista',
  },
  items: [
    {
      product: 'groups',
      en: 'In Lines, a message you sent from your phone could arrive without the contact\'s number and open a second chat titled "WhatsApp contact" next to the real one. Now both chats are joined into one as soon as WhatsApp shows they are the same person, including when both have the same profile photo, and nothing is lost: messages, notes, labels and assignments stay in the chat that remains.',
      es: 'En Lines, un mensaje que mandabas desde tu teléfono podía llegar sin el número del contacto y abrir un segundo chat con el título "Contacto de WhatsApp" al lado del verdadero. Ahora los dos chats se juntan en uno apenas WhatsApp muestra que son la misma persona, también cuando tienen la misma foto de perfil, y no se pierde nada: mensajes, notas, etiquetas y asignaciones quedan en el chat que queda.',
      pt: 'No Lines, uma mensagem enviada do seu celular podia chegar sem o número do contato e abrir uma segunda conversa com o título "Contato do WhatsApp" ao lado da verdadeira. Agora as duas se juntam em uma assim que o WhatsApp mostra que são a mesma pessoa, inclusive quando têm a mesma foto de perfil, e nada se perde: mensagens, notas, etiquetas e atribuições ficam na conversa que permanece.',
    },
    {
      product: 'inbox',
      en: 'The same fix in Inbox: a contact whose chat arrived once by phone number and once without it is one chat, with all its messages.',
      es: 'Lo mismo en Inbox: un contacto cuyo chat llegó una vez con el teléfono y otra sin él es un solo chat, con todos sus mensajes.',
      pt: 'O mesmo no Inbox: um contato cujo chat chegou uma vez com o telefone e outra sem ele é um único chat, com todas as mensagens.',
    },
  ],
} satisfies ChangelogEntry;
