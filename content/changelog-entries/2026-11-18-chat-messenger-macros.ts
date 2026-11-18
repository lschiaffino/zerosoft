import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-chat-messenger-macros',
  date: '2026-11-18',
  title: {
    en: 'Chat: messenger fonts and search, scheduled campaigns and your own snooze options',
    es: 'Chat: fuentes y búsqueda en el messenger, campañas programadas y opciones propias de posponer',
    pt: 'Chat: fontes e busca no messenger, campanhas agendadas e opções próprias de adiar',
  },
  items: [
    {
      product: 'chat',
      en: 'Messenger: seven fonts, a reply time under the header, search inside the conversation and control over who attaches files. Your site can send person attributes with a signed identity.',
      es: 'Messenger: siete fuentes, tiempo de respuesta bajo el encabezado, búsqueda dentro de la conversación y control de quién adjunta archivos. Tu sitio puede mandar atributos de la persona con identidad firmada.',
      pt: 'Messenger: sete fontes, tempo de resposta sob o cabeçalho, busca dentro da conversa e controle de quem anexa arquivos. Seu site pode enviar atributos da pessoa com identidade assinada.',
    },
    {
      product: 'chat',
      en: 'Inbox: your own snooze options by team and how often each saved reply is used. Campaigns can be scheduled.',
      es: 'Bandeja: opciones propias de posponer por equipo y cuánto se usa cada respuesta guardada. Las campañas se pueden programar.',
      pt: 'Caixa de entrada: opções próprias de adiar por equipe e quanto cada resposta salva é usada. As campanhas podem ser agendadas.',
    },
  ],
} satisfies ChangelogEntry;
