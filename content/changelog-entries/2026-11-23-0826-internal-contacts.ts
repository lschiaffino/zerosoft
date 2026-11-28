import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-internal-contacts',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: internal contacts',
    es: 'Lines e Inbox: contactos internos',
    pt: 'Lines e Inbox: contatos internos',
  },
  items: [
    {
      product: 'groups',
      en: 'Admins can mark teammates and company numbers as internal, in Settings › Internal contacts or from anyone\'s contact info. The numbers connected in Lines count as internal unless you turn that rule off, and a contact can be marked as not internal. When an internal contact writes in a group, it counts as a reply from your team: the chat stops waiting, an open ticket gets its first response and no keyword ticket opens. Internal shows next to their name and in the member list, a filter separates one to one chats with them, and Reports leave them out.',
      es: 'Los admins pueden marcar a las personas del equipo y los números de la empresa como internos, en Ajustes › Contactos internos o desde la info de cualquier contacto. Los números conectados en Lines cuentan como internos salvo que apagues esa regla, y se puede marcar a alguien como no interno. Cuando un contacto interno escribe en un grupo, cuenta como respuesta del equipo: el chat deja de esperar, un ticket abierto toma su primera respuesta y no se abre un ticket por palabra clave. Interno se ve al lado de su nombre y en la lista de miembros, un filtro separa los chats 1:1 con ellos y Reportes los deja afuera.',
      pt: 'Os admins podem marcar as pessoas da equipe e os números da empresa como internos, em Ajustes › Contatos internos ou pelos dados de qualquer contato. Os números conectados no Lines contam como internos a menos que você desligue essa regra, e dá para marcar alguém como não interno. Quando um contato interno escreve em um grupo, conta como resposta da equipe: a conversa deixa de esperar, um ticket aberto recebe a primeira resposta e não se abre ticket por palavra-chave. Interno aparece ao lado do nome e na lista de membros, um filtro separa as conversas 1:1 com eles e os Relatórios os deixam de fora.',
    },
    {
      product: 'inbox',
      en: 'The same internal contacts apply to your Inbox, plus email addresses at your company domains: chats with them stay in your inbox but leave To reply and Waiting on others, have an Internal view, show Internal next to their name in groups and stay out of Analytics. Workspace admins manage them in Inbox Settings too.',
      es: 'Los mismos contactos internos valen en tu Inbox, más los correos de los dominios de la empresa: los chats con ellos siguen en tu bandeja pero salen de Por responder y de Esperando, tienen la vista Internos, muestran Interno al lado del nombre en los grupos y quedan fuera de Analítica. Los admins del workspace también los manejan desde Ajustes de Inbox.',
      pt: 'Os mesmos contatos internos valem no seu Inbox, mais os e-mails dos domínios da empresa: as conversas com eles continuam na sua caixa mas saem de Por responder e de Esperando, têm a vista Internos, mostram Interno ao lado do nome nos grupos e ficam fora da Análise. Os admins do workspace também os gerenciam em Ajustes do Inbox.',
    },
  ],
} satisfies ChangelogEntry;
