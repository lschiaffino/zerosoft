import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-chat-phone-keyboard',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines on the phone: the keyboard and scrolling work like WhatsApp',
    es: 'Inbox y Lines en el teléfono: el teclado y el scroll funcionan como en WhatsApp',
    pt: 'Inbox e Lines no celular: o teclado e a rolagem funcionam como no WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'With the keyboard open, the chat uses the whole visible screen: the app bar and the waiting notice step aside and come back when you close it. Sending keeps the keyboard open, tapping the conversation closes it, and the iPhone no longer zooms in when you tap the message field.',
      es: 'Con el teclado abierto, el chat usa toda la pantalla que se ve: la barra de la app y el aviso de espera se corren y vuelven al cerrarlo. Mandar deja el teclado abierto, tocar la conversación lo cierra, y el iPhone ya no agranda la página al tocar el campo del mensaje.',
      pt: 'Com o teclado aberto, a conversa usa toda a tela visível: a barra do app e o aviso de espera saem e voltam ao fechar. Enviar mantém o teclado aberto, tocar na conversa o fecha, e o iPhone não aumenta mais a página ao tocar no campo da mensagem.',
    },
    {
      product: 'groups',
      en: 'Lines does the same. In both apps, scrolling the chat list or a conversation no longer drags the whole page or triggers the browser pull to refresh, and the message field sits above the iPhone home bar in the installed app.',
      es: 'Lines hace lo mismo. En las dos apps, el scroll de la lista o de una conversación ya no arrastra la página entera ni dispara el "tirar para recargar" del navegador, y el campo del mensaje queda arriba de la barra de inicio del iPhone en la app instalada.',
      pt: 'O Lines faz o mesmo. Nos dois apps, rolar a lista ou uma conversa não arrasta mais a página inteira nem dispara o "puxar para atualizar" do navegador, e o campo da mensagem fica acima da barra de início do iPhone no app instalado.',
    },
  ],
} satisfies ChangelogEntry;
