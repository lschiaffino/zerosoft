import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-notifications-current-access',
  date: '2026-11-23',
  title: {
    en: 'Notifications follow what you can open today',
    es: 'Los avisos siguen lo que hoy podés abrir',
    pt: 'Os avisos seguem o que você pode abrir hoje',
  },
  items: [
    {
      product: 'track',
      en: 'The notification bell, its unread count, the desktop app and Track emails now show only notifications for issues, projects and initiatives you can open today, the same as the Track inbox.',
      es: 'La campana de avisos, su contador, la app de escritorio y los emails de Track ahora muestran solo avisos de issues, projects e iniciativas que hoy podés abrir, igual que el inbox de Track.',
      pt: 'O sino de avisos, o contador, o app de desktop e os emails do Track agora mostram só avisos de issues, projects e iniciativas que você pode abrir hoje, igual ao inbox do Track.',
    },
  ],
} satisfies ChangelogEntry;
