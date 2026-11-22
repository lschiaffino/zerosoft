import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-report-message',
  date: '2026-11-22',
  title: {
    en: 'Inbox and Lines: report a WhatsApp message',
    es: 'Inbox y Lines: reportar un mensaje de WhatsApp',
    pt: 'Inbox e Lines: denunciar uma mensagem do WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'Report, in the menu of a message you received, asks first and can also block the contact or exit the group, as on WhatsApp. The message keeps a small flag. The report stays in Inbox: the WhatsApp server linked to your account cannot send reports to WhatsApp, and the dialog says so, so report it from the phone too if you want WhatsApp to review it.',
      es: 'Reportar, en el menú de un mensaje recibido, pregunta antes y puede también bloquear al contacto o salir del grupo, como en WhatsApp. El mensaje queda con una banderita. El reporte queda en Inbox: el servidor de WhatsApp vinculado a tu cuenta no puede mandarle reportes a WhatsApp, y el aviso lo dice, así que reportalo también desde el teléfono si querés que WhatsApp lo revise.',
      pt: 'Denunciar, no menu de uma mensagem recebida, pergunta antes e também pode bloquear o contato ou sair do grupo, como no WhatsApp. A mensagem fica com uma bandeirinha. A denúncia fica no Inbox: o servidor de WhatsApp vinculado à sua conta não consegue enviar denúncias ao WhatsApp, e o aviso diz isso, então denuncie também pelo celular se quiser que o WhatsApp analise.',
    },
    {
      product: 'groups',
      en: 'The same Report in the message menu of Lines, with the option to block the contact or leave the group. The chat log records who reported it.',
      es: 'El mismo Reportar en el menú del mensaje de Lines, con la opción de bloquear al contacto o salir del grupo. El log del chat anota quién lo reportó.',
      pt: 'O mesmo Denunciar no menu da mensagem do Lines, com a opção de bloquear o contato ou sair do grupo. O log da conversa registra quem denunciou.',
    },
  ],
} satisfies ChangelogEntry;
