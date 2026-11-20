import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-periskope-api-import',
  date: '2026-11-20',
  title: {
    en: 'Lines: move from Periskope with its API key',
    es: 'Lines: pasarse desde Periskope con su clave de API',
    pt: 'Lines: migrar do Periskope com a chave de API',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Migrate now imports straight from your Periskope account: paste an API key from Periskope and Lines brings the labels, assignee and custom properties of your chats (properties that do not exist yet are created with their options), contact labels, tickets with their status, priority, assignee and original date, and private notes with their author. A preview shows what will change before anything is written, and importing again does not duplicate tickets or notes. The key is used only for that import and is not saved. CSV files still work for quick replies and labels.',
      es: 'Ajustes › Migrar ahora importa directo desde tu cuenta de Periskope: pegás una clave de API de Periskope y Lines trae las etiquetas, el asignado y las propiedades propias de tus chats (las propiedades que no existen se crean con sus opciones), las etiquetas de los contactos, los tickets con su estado, prioridad, asignado y fecha original, y las notas privadas con su autor. Una vista previa muestra qué va a cambiar antes de escribir nada, y volver a importar no duplica tickets ni notas. La clave se usa solo para esa importación y no se guarda. Los CSV siguen sirviendo para respuestas rápidas y etiquetas.',
      pt: 'Configurações › Migrar agora importa direto da sua conta do Periskope: cole uma chave de API do Periskope e o Lines traz as etiquetas, o responsável e as propriedades próprias dos seus chats (as propriedades que não existem são criadas com as opções), as etiquetas dos contatos, os tickets com status, prioridade, responsável e data original, e as notas privadas com o autor. Uma prévia mostra o que vai mudar antes de gravar qualquer coisa, e importar de novo não duplica tickets nem notas. A chave é usada só nessa importação e não é salva. Os CSV continuam servindo para respostas rápidas e etiquetas.',
    },
  ],
} satisfies ChangelogEntry;
