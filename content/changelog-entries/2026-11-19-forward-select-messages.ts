import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-forward-select-messages',
  date: '2026-11-19',
  title: {
    en: 'Forward lets you pick several messages first',
    es: 'Reenviar te deja elegir varios mensajes antes',
    pt: 'Encaminhar deixa escolher várias mensagens antes',
  },
  items: [
    {
      product: 'groups',
      en: 'Choosing Forward on a message now works like WhatsApp: the message is ticked, a checkbox shows next to the others so you can add more, and a bar at the bottom counts how many are selected. Forward sends them all to the chats you pick, oldest first. Messages that cannot be forwarded (deleted, not sent, view once) have no checkbox. Esc or the X leaves without forwarding, and the checkboxes work with Tab and Space.',
      es: 'Elegir Reenviar en un mensaje ahora funciona como WhatsApp: el mensaje queda tildado, aparece una casilla al lado de los demás para sumar otros y una barra abajo cuenta cuántos van. Reenviar los manda todos a los chats que elijas, del más viejo al más nuevo. Los mensajes que no se pueden reenviar (borrados, sin enviar, de ver una vez) no tienen casilla. Esc o la X salen sin reenviar, y las casillas funcionan con Tab y Espacio.',
      pt: 'Escolher Encaminhar em uma mensagem agora funciona como no WhatsApp: a mensagem fica marcada, aparece uma caixa ao lado das outras para somar mais e uma barra embaixo conta quantas estão selecionadas. Encaminhar envia todas para as conversas que você escolher, da mais antiga para a mais nova. As mensagens que não podem ser encaminhadas (apagadas, não enviadas, de visualização única) não têm caixa. Esc ou o X saem sem encaminhar, e as caixas funcionam com Tab e Espaço.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: Forward on a WhatsApp message starts a selection with that message ticked, you add the others you want, and they all go out in order to the chats you pick.',
      es: 'Lo mismo en Inbox: Reenviar en un mensaje de WhatsApp empieza una selección con ese mensaje tildado, sumás los otros que quieras y salen todos en orden a los chats que elijas.',
      pt: 'O mesmo no Inbox: Encaminhar em uma mensagem do WhatsApp começa uma seleção com essa mensagem marcada, você soma as outras que quiser e todas saem em ordem para as conversas que escolher.',
    },
  ],
} satisfies ChangelogEntry;
