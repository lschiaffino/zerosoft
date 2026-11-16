import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-private-imports',
  date: '2026-11-16',
  title: {
    en: 'Files you upload to import are private too',
    es: 'Los archivos que subís para importar también son privados',
    pt: 'Os arquivos que você envia para importar também são privados',
  },
  items: [
    {
      product: 'inbox',
      en: 'A WhatsApp chat export you import into Inbox is stored privately while it imports, only the import reads it, and it is deleted when it finishes.',
      es: 'La exportación de chats de WhatsApp que importás en Inbox queda guardada en privado mientras se importa, solo la lee la importación y se borra al terminar.',
      pt: 'A exportação de conversas do WhatsApp que você importa no Inbox fica guardada de forma privada durante a importação, só a importação lê e ela é apagada ao terminar.',
    },
    {
      product: 'docs',
      en: 'The Notion, Evernote or other zip you import into Docs, and the parts unpacked from it, are stored privately and deleted when the import ends.',
      es: 'El zip de Notion, Evernote u otra app que importás en Docs, y las partes que se sacan de él, quedan guardados en privado y se borran cuando termina la importación.',
      pt: 'O zip do Notion, Evernote ou outro app que você importa no Docs, e as partes extraídas dele, ficam guardados de forma privada e são apagados quando a importação termina.',
    },
  ],
} satisfies ChangelogEntry;
