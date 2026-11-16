import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-lid-duplicates',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: one chat per person, even when WhatsApp hides the number',
    es: 'Inbox y Lines: un solo chat por persona, aunque WhatsApp oculte el número',
    pt: 'Inbox e Lines: uma só conversa por pessoa, mesmo quando o WhatsApp oculta o número',
  },
  items: [
    {
      product: 'inbox',
      en: 'WhatsApp sometimes sends a contact with a private id instead of their phone number. When that happened to a message you sent, or to a reply after you wrote to someone, the person could show up twice in the list, once with an odd long number. Now your sent messages, their replies and the read receipts all land in the same chat, and two chats that were already split join into one with their messages, folders, notes, pins and scheduled messages. A chat that only has the private id shows the contact name, or "WhatsApp contact", never the id as a phone number.',
      es: 'WhatsApp a veces manda un contacto con un id privado en lugar de su número. Cuando pasaba con un mensaje que mandaste, o con una respuesta después de que le escribiste a alguien, la persona podía aparecer dos veces en la lista, una con un número largo raro. Ahora lo que mandás, sus respuestas y las tildes de leído quedan en el mismo chat, y dos chats que ya estaban separados se juntan en uno con sus mensajes, carpetas, notas, fijados y mensajes programados. Un chat que solo tiene el id privado muestra el nombre del contacto, o "Contacto de WhatsApp", nunca el id como si fuera un teléfono.',
      pt: 'O WhatsApp às vezes manda um contato com um id privado em vez do número. Quando isso acontecia com uma mensagem que você mandou, ou com uma resposta depois que você escreveu para alguém, a pessoa podia aparecer duas vezes na lista, uma com um número longo estranho. Agora o que você manda, as respostas e as confirmações de leitura ficam na mesma conversa, e duas conversas que já estavam separadas viram uma só com mensagens, pastas, notas, fixados e mensagens agendadas. Uma conversa que só tem o id privado mostra o nome do contato, ou "Contato do WhatsApp", nunca o id como se fosse um telefone.',
    },
    {
      product: 'groups',
      en: 'Lines does the same: the echo of a message sent from the line, and replies or read receipts that come back with the private id, go to the chat with the phone number instead of opening a second one.',
      es: 'Lines hace lo mismo: el eco de un mensaje mandado desde la línea, y las respuestas o tildes de leído que vuelven con el id privado, van al chat con el número en lugar de abrir otro.',
      pt: 'O Lines faz o mesmo: o eco de uma mensagem enviada pela linha, e as respostas ou confirmações de leitura que voltam com o id privado, vão para a conversa com o número em vez de abrir outra.',
    },
  ],
} satisfies ChangelogEntry;
