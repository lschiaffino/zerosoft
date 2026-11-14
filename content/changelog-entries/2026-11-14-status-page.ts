import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-status-page',
  date: '2026-11-14',
  title: {
    en: 'A live status page',
    es: 'Una página de estado en vivo',
    pt: 'Uma página de status ao vivo',
  },
  items: [
    {
      product: 'platform',
      en: 'The status page now shows real data. Every minute we check the website, the apps and their database, WhatsApp for Lines and Inbox, and email. Each one has 90 days of daily bars and its uptime. When a check fails twice in a row an incident opens on its own, with a timeline of what happened, and it closes after three passing checks. Past incidents from the last 90 days stay listed.',
      es: 'La página de estado ahora muestra datos reales. Cada minuto chequeamos el sitio, las apps y su base de datos, WhatsApp de Lines e Inbox, y el email. Cada uno tiene 90 días de barras por día y su disponibilidad. Cuando un chequeo falla dos veces seguidas se abre un incidente solo, con una línea de tiempo de lo que pasó, y se cierra después de tres chequeos que pasan. Los incidentes de los últimos 90 días quedan en la lista.',
      pt: 'A página de status agora mostra dados reais. A cada minuto verificamos o site, os apps e o banco de dados deles, o WhatsApp do Lines e do Inbox, e o email. Cada um tem 90 dias de barras por dia e sua disponibilidade. Quando uma verificação falha duas vezes seguidas um incidente abre sozinho, com uma linha do tempo do que aconteceu, e fecha depois de três verificações que passam. Os incidentes dos últimos 90 dias ficam na lista.',
    },
  ],
} satisfies ChangelogEntry;
