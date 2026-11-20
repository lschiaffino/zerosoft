import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0613-scheduled-wa-mentions',
  date: '2026-11-20',
  title: {
    en: 'Mentions in WhatsApp groups now arrive as mentions, also in scheduled messages',
    es: 'Las menciones en grupos de WhatsApp llegan como mención, también en los mensajes programados',
    pt: 'As menções em grupos do WhatsApp chegam como menção, também nas mensagens agendadas',
  },
  items: [
    {
      product: 'groups',
      en: 'A message scheduled with "Send later" (or a repeating one to a single group) kept the @mention only as text: on the phone it showed the name or a number without highlighting and the person got no mention. Now the scheduled message remembers who each @Name is and goes out like one sent right away, with the mention. It also reaches WhatsApp the right way in groups that identify people by their anonymous id, and for phone numbers from Argentina and Mexico, which showed as a plain number on the phone.',
      es: 'Un mensaje programado con "Enviar más tarde" (o uno recurrente a un solo grupo) dejaba la @mención solo como texto: en el teléfono se veía el nombre o un número sin resaltar y a la persona no le llegaba la mención. Ahora el programado recuerda a quién es cada @Nombre y sale igual que uno mandado en el momento, con la mención. Además llega bien a WhatsApp en los grupos que identifican a cada persona por su id anónimo y con los números de Argentina y México, que en el teléfono se veían como un número suelto.',
      pt: 'Uma mensagem agendada com "Enviar mais tarde" (ou uma recorrente para um só grupo) deixava a @menção só como texto: no telefone aparecia o nome ou um número sem destaque e a pessoa não recebia a menção. Agora a mensagem agendada lembra quem é cada @Nome e sai igual a uma enviada na hora, com a menção. Também chega certo ao WhatsApp nos grupos que identificam cada pessoa pelo id anônimo e com os números da Argentina e do México, que no telefone apareciam como um número solto.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: a message scheduled in a WhatsApp group with an @mention goes out as a mention, and mentions sent right away reach the phone highlighted in groups that use anonymous ids and with numbers from Argentina and Mexico.',
      es: 'Lo mismo en Inbox: un mensaje programado en un grupo de WhatsApp con una @mención sale como mención, y las menciones mandadas en el momento llegan resaltadas al teléfono en los grupos que usan ids anónimos y con números de Argentina y México.',
      pt: 'O mesmo no Inbox: uma mensagem agendada em um grupo do WhatsApp com uma @menção sai como menção, e as menções enviadas na hora chegam destacadas no telefone nos grupos que usam ids anônimos e com números da Argentina e do México.',
    },
  ],
} satisfies ChangelogEntry;
