import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-chat-photos',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: profile photos in one on one chats and contact cards',
    es: 'Inbox y Lines: fotos de perfil en los chats individuales y las tarjetas de contacto',
    pt: 'Inbox e Lines: fotos de perfil nas conversas individuais e nos cartões de contato',
  },
  items: [
    {
      product: 'inbox',
      en: 'A one on one WhatsApp chat that showed only an initial now gets the contact profile photo. Opening the chat asks WhatsApp for it if it is missing or older than a week, and the daily review fills in the rest a few at a time. The photo is saved as a copy in your workspace, so it no longer disappears when the WhatsApp link expires, and it shows in the chat list, the chat header and the contact info.',
      es: 'Un chat individual de WhatsApp que mostraba solo una inicial ahora tiene la foto de perfil del contacto. Al abrir el chat se le pide a WhatsApp si falta o tiene más de una semana, y el repaso diario completa el resto de a poco. La foto queda guardada como copia en tu espacio de trabajo, así que ya no desaparece cuando vence el enlace de WhatsApp, y se ve en la lista de chats, en el encabezado del chat y en la info del contacto.',
      pt: 'Uma conversa individual do WhatsApp que mostrava só uma inicial agora tem a foto de perfil do contato. Ao abrir a conversa, ela é pedida ao WhatsApp se estiver faltando ou tiver mais de uma semana, e a revisão diária completa o resto aos poucos. A foto fica salva como cópia no seu espaço de trabalho, então não some mais quando o link do WhatsApp expira, e aparece na lista de conversas, no cabeçalho da conversa e nas informações do contato.',
    },
    {
      product: 'groups',
      en: 'Lines does the same for one on one chats on each line: the photo is requested when you open the chat and in the daily review, and the list and the chat show it.',
      es: 'Lines hace lo mismo con los chats individuales de cada línea: la foto se pide al abrir el chat y en el repaso diario, y la lista y el chat la muestran.',
      pt: 'O Lines faz o mesmo com as conversas individuais de cada linha: a foto é pedida ao abrir a conversa e na revisão diária, e a lista e a conversa a mostram.',
    },
    {
      product: 'inbox',
      en: 'Shared contact cards look like WhatsApp: the person profile photo when they have one, the number formatted like the rest of the app, and Message below, which opens or starts the chat with that number on the same account. A message with several contacts shows the first name and how many more, with View all.',
      es: 'Las tarjetas de contacto compartidas se ven como en WhatsApp: la foto de perfil de la persona si tiene, el número con el mismo formato que el resto de la app y Enviar mensaje abajo, que abre o empieza el chat con ese número en la misma cuenta. Un mensaje con varios contactos muestra el primer nombre y cuántos más hay, con Ver todos.',
      pt: 'Os cartões de contato compartilhados aparecem como no WhatsApp: a foto de perfil da pessoa quando ela tem, o número no mesmo formato do resto do app e Enviar mensagem embaixo, que abre ou inicia a conversa com esse número na mesma conta. Uma mensagem com vários contatos mostra o primeiro nome e quantos mais existem, com Ver todos.',
    },
    {
      product: 'groups',
      en: 'In Lines, Message on a contact card opens or starts the chat on the same line, and Save contact adds it to CRM. People who cannot see phone numbers get the number hidden on the card too, and Message still works for them.',
      es: 'En Lines, Enviar mensaje en una tarjeta de contacto abre o empieza el chat en la misma línea, y Guardar la agrega al CRM. Quien no puede ver los números también los ve ocultos en la tarjeta, y Enviar mensaje le sigue funcionando.',
      pt: 'No Lines, Enviar mensagem em um cartão de contato abre ou inicia a conversa na mesma linha, e Salvar adiciona ao CRM. Quem não pode ver os números também os vê ocultos no cartão, e Enviar mensagem continua funcionando.',
    },
  ],
} satisfies ChangelogEntry;
