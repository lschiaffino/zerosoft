import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0036-lines-team-folders',
  date: '2026-11-20',
  title: {
    en: 'Lines: team folders next to your own',
    es: 'Lines: carpetas del equipo junto a las tuyas',
    pt: 'Lines: pastas da equipe ao lado das suas',
  },
  items: [
    {
      product: 'groups',
      en: 'Admins can create team folders and subfolders in Lines. Everyone in the workspace sees them under "Team" in the sidebar, above your own folders under "Mine". Anyone who can edit a chat can drop it in a team folder, and it shows there for everyone; it can also stay in one of your own folders at the same time. Only admins rename, move or delete team folders, and deleting one takes its chats out of it without touching anyone\'s own folders. Counts and lists only include chats on lines you can see.',
      es: 'Los admins pueden crear carpetas y subcarpetas del equipo en Lines. Todo el workspace las ve bajo "Equipo" en el lateral, arriba de tus carpetas, que quedan bajo "Mías". Cualquiera que puede editar un chat lo puede soltar en una carpeta del equipo, y ahí lo ven todos; además puede seguir en una carpeta tuya. Solo los admins renombran, mueven o borran las del equipo, y borrar una saca sus chats de ella sin tocar las carpetas de nadie. Los conteos y las listas solo incluyen chats de líneas que ves.',
      pt: 'Os admins podem criar pastas e subpastas da equipe no Lines. Todo o workspace as vê em "Equipe" na lateral, acima das suas pastas, que ficam em "Minhas". Qualquer pessoa que pode editar uma conversa pode soltá-la numa pasta da equipe, e todos a veem lá; ela também pode continuar numa pasta sua. Só os admins renomeiam, movem ou excluem as pastas da equipe, e excluir uma tira as conversas dela sem mexer nas pastas de ninguém. As contagens e listas só incluem conversas de linhas que você vê.',
    },
  ],
} satisfies ChangelogEntry;
