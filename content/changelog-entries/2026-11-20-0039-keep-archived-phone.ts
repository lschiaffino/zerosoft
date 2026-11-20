import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0039-keep-archived-phone',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: "Keep archived" chats stay archived on your phone too',
    es: 'Inbox y Lines: los chats con "Mantener archivado" también quedan archivados en el teléfono',
    pt: 'Inbox e Lines: as conversas com "Manter arquivada" também ficam arquivadas no celular',
  },
  items: [
    {
      product: 'inbox',
      en: 'A chat with "Keep archived" on stayed archived here, but WhatsApp on the phone took it out of Archived with every new message. Now, after a message arrives or is sent, zerosoft archives the chat again on WhatsApp, at most once every 20 seconds per chat. If you unarchive the chat yourself on the phone, "Keep archived" turns off here too, the same as unarchiving it in zerosoft.',
      es: 'Un chat con "Mantener archivado" quedaba archivado acá, pero WhatsApp en el teléfono lo sacaba de Archivados con cada mensaje nuevo. Ahora, después de que llega o sale un mensaje, zerosoft vuelve a archivar el chat en WhatsApp, como mucho una vez cada 20 segundos por chat. Si lo desarchivás vos en el teléfono, "Mantener archivado" se apaga también acá, igual que al desarchivarlo en zerosoft.',
      pt: 'Uma conversa com "Manter arquivada" ficava arquivada aqui, mas o WhatsApp no celular a tirava de Arquivadas a cada mensagem nova. Agora, depois que uma mensagem chega ou sai, o zerosoft arquiva a conversa de novo no WhatsApp, no máximo uma vez a cada 20 segundos por conversa. Se você desarquivar a conversa no celular, "Manter arquivada" também se desliga aqui, como ao desarquivá-la no zerosoft.',
    },
    {
      product: 'groups',
      en: 'The same for Lines chats with "Keep archived" on.',
      es: 'Lo mismo para los chats de Lines con "Mantener archivado".',
      pt: 'O mesmo para as conversas do Lines com "Manter arquivada".',
    },
  ],
} satisfies ChangelogEntry;
