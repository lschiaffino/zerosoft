import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-chat-drafts-on-update',
  date: '2026-11-17',
  title: {
    en: 'Lines and Inbox: what you are typing stays when something else saves',
    es: 'Lines e Inbox: lo que estás escribiendo queda aunque se guarde otra cosa',
    pt: 'Lines e Inbox: o que você está digitando fica mesmo quando outra coisa é salva',
  },
  items: [
    {
      product: 'groups',
      en: 'In a chat’s details, saving a label or "Keep archived" erased the name, description or properties you had not saved yet. Now each field only changes when its own value changes.',
      es: 'En los detalles de un chat, guardar una etiqueta o "Mantener archivado" borraba el nombre, la descripción o las propiedades que todavía no habías guardado. Ahora cada campo cambia solo cuando cambia su propio valor.',
      pt: 'Nos detalhes de um chat, salvar uma etiqueta ou "Manter arquivado" apagava o nome, a descrição ou as propriedades que você ainda não tinha salvado. Agora cada campo muda só quando o próprio valor muda.',
    },
    {
      product: 'inbox',
      en: 'Renaming an email thread no longer closes its notes or drops the text you had not saved.',
      es: 'Renombrar un hilo de correo ya no cierra sus notas ni borra el texto que no habías guardado.',
      pt: 'Renomear uma conversa de e-mail não fecha mais as notas nem apaga o texto que você não tinha salvado.',
    },
  ],
} satisfies ChangelogEntry;
