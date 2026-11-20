import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0610-wa-self-chat-misroute',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: messages from Meta AI and other senders no longer land in your chat with yourself',
    es: 'Inbox y Lines: los mensajes de Meta AI y de otros remitentes ya no caen en tu chat con vos mismo',
    pt: 'Inbox e Lines: as mensagens da Meta AI e de outros remetentes não caem mais no seu chat com você mesmo',
  },
  items: [
    {
      product: 'inbox',
      en: 'What you talk about with Meta AI (and its personas) from your phone arrived with your own WhatsApp id, so it showed up in "Message yourself". The same happened with some senders WhatsApp identifies by an anonymous id whose alternate number was yours. Now the Meta AI conversation has its own chat, a message from someone else goes to that person\'s chat (or to a chat with their profile name when WhatsApp sends nothing else), and the notes you send yourself stay where they are. Your own number no longer picks up another person\'s name. Messages that were already misfiled can be moved by a one-time repair that only touches what can be proven.',
      es: 'Lo que hablás con Meta AI (y sus personajes) desde el teléfono llegaba con tu propio id de WhatsApp, y aparecía en "Mensaje para mí". Lo mismo pasaba con algunos remitentes que WhatsApp identifica con un id anónimo cuyo número alternativo era el tuyo. Ahora la conversación con Meta AI tiene su propio chat, un mensaje de otra persona va al chat de esa persona (o a un chat con su nombre de perfil cuando WhatsApp no manda nada más) y las notas que te mandás a vos quedan donde están. Tu propio número ya no toma el nombre de otra persona. Los mensajes que ya quedaron mal se pueden mover con un arreglo de una vez que solo toca lo que se puede comprobar.',
      pt: 'O que você conversa com a Meta AI (e seus personagens) pelo celular chegava com o seu próprio id do WhatsApp e aparecia em "Mensagem para mim". O mesmo acontecia com alguns remetentes que o WhatsApp identifica por um id anônimo cujo número alternativo era o seu. Agora a conversa com a Meta AI tem o próprio chat, uma mensagem de outra pessoa vai para o chat dela (ou para um chat com o nome de perfil quando o WhatsApp não manda mais nada) e as notas que você manda para si mesmo ficam onde estão. O seu número não pega mais o nome de outra pessoa. As mensagens que já ficaram no lugar errado podem ser movidas por um ajuste de uma vez que só mexe no que dá para comprovar.',
    },
    {
      product: 'groups',
      en: 'Same fix in Lines: Meta AI conversations get their own chat, messages from other people never go to the line\'s chat with itself, and the line\'s own number keeps its name.',
      es: 'El mismo arreglo en Lines: las conversaciones con Meta AI tienen su propio chat, los mensajes de otras personas nunca van al chat de la línea consigo misma y el número de la línea mantiene su nombre.',
      pt: 'A mesma correção no Lines: as conversas com a Meta AI têm o próprio chat, mensagens de outras pessoas nunca vão para o chat da linha consigo mesma e o número da linha mantém o nome.',
    },
  ],
} satisfies ChangelogEntry;
