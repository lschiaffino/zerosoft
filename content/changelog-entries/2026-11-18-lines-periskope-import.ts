import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-periskope-import',
  date: '2026-11-18',
  title: {
    en: 'Move from Periskope to Lines with a CSV',
    es: 'Pasar de Periskope a Lines con un CSV',
    pt: 'Passar do Periskope para o Lines com um CSV',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Move from Periskope reads CSV files of labels, quick replies, chats and contacts. A preview shows what would change before anything is written. Chats get their labels, assignee and custom properties; messages still come from WhatsApp when you connect each line.',
      es: 'Ajustes › Migrar de Periskope lee archivos CSV de etiquetas, respuestas rápidas, chats y contactos. Una vista previa muestra qué cambiaría antes de escribir nada. Los chats reciben sus etiquetas, asignado y propiedades propias; los mensajes siguen llegando de WhatsApp al conectar cada línea.',
      pt: 'Configurações › Migrar do Periskope lê arquivos CSV de etiquetas, respostas rápidas, chats e contatos. Uma prévia mostra o que mudaria antes de gravar qualquer coisa. Os chats recebem suas etiquetas, responsável e propriedades próprias; as mensagens continuam vindo do WhatsApp ao conectar cada linha.',
    },
  ],
} satisfies ChangelogEntry;
