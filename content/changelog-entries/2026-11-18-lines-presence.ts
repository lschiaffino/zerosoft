import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-presence',
  date: '2026-11-18',
  title: {
    en: 'Lines: online, away and offline',
    es: 'Lines: en línea, ausente y desconectado',
    pt: 'Lines: online, ausente e offline',
  },
  items: [
    {
      product: 'groups',
      en: 'Each person picks Online, Away or Offline from the account menu at the bottom of the sidebar, with a colored dot on their photo. Automatic assignment only gives new chats to people who are online, and Away keeps their chats. A rule in Settings › Assignment can also hand the open chats of someone who goes offline to the people online, in turn. That option is off by default.',
      es: 'Cada persona elige En línea, Ausente o Desconectado desde el menú de la cuenta, al pie del sidebar, con un punto de color en su foto. La asignación automática solo da chats nuevos a quienes están en línea, y quien está ausente conserva sus chats. Una regla de Ajustes › Asignación también puede pasar los chats abiertos de quien se desconecta a quienes están en línea, por turno. Esa opción viene apagada.',
      pt: 'Cada pessoa escolhe Online, Ausente ou Offline no menu da conta, no rodapé da barra lateral, com um ponto colorido na foto. A atribuição automática só entrega chats novos a quem está online, e quem está ausente mantém seus chats. Uma regra em Ajustes › Atribuição também pode passar os chats abertos de quem fica offline para quem está online, por vez. Essa opção vem desligada.',
    },
  ],
} satisfies ChangelogEntry;
