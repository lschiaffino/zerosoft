import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-group-you',
  date: '2026-11-23',
  title: {
    en: 'Lines: a group header ends in You, like WhatsApp Web',
    es: 'Lines: el encabezado de un grupo termina en Vos, como WhatsApp Web',
    pt: 'Lines: o cabeçalho de um grupo termina em Você, como no WhatsApp Web',
  },
  items: [
    {
      product: 'groups',
      en: "The line under a group name lists its members like WhatsApp Web: people with a name first, then numbers, and You last. It used to show the line's own number among the members. Inbox uses the same list, and adds … when the group has more members than fit.",
      es: 'La línea debajo del nombre de un grupo lista sus miembros como WhatsApp Web: primero las personas con nombre, después los números y Vos al final. Antes mostraba el número de la propia línea entre los miembros. Inbox usa la misma lista y suma … cuando el grupo tiene más miembros de los que entran.',
      pt: 'A linha abaixo do nome de um grupo lista os membros como no WhatsApp Web: primeiro as pessoas com nome, depois os números e Você no final. Antes mostrava o número da própria linha entre os membros. O Inbox usa a mesma lista e acrescenta … quando o grupo tem mais membros do que cabem.',
    },
  ],
} satisfies ChangelogEntry;
