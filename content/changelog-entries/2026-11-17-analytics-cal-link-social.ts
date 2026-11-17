import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-analytics-cal-link-social',
  date: '2026-11-17',
  title: {
    en: 'Cal, Link and Social: analytics with the same layout as Lines',
    es: 'Cal, Link y Social: analítica con el mismo formato que Lines',
    pt: 'Cal, Link e Social: análises com o mesmo formato do Lines',
  },
  items: [
    {
      product: 'cal',
      en: 'Analytics compares bookings created, still on, cancelled and no-shows with the previous period of the same length, adds the median time people book ahead, and shows bookings per day, by event type, popular times and, for admins, by person.',
      es: 'La analítica compara reservas creadas, en pie, canceladas y no-shows con el período anterior del mismo largo, suma la mediana de cuánto antes se reserva y muestra reservas por día, por tipo de evento, horarios más elegidos y, para admins, por persona.',
      pt: 'As análises comparam agendamentos criados, mantidos, cancelados e no-shows com o período anterior do mesmo tamanho, somam a mediana de antecedência e mostram agendamentos por dia, por tipo de evento, horários mais escolhidos e, para admins, por pessoa.',
    },
    {
      product: 'link',
      en: 'Analytics shows clicks, QR scans, leads, sales and lead rate against the previous period, with visits per day, top links, the conversion funnel and breakdowns by referrer, country, device, browser and city. Filters, time zone, CSV and the Events tab stay.',
      es: 'La analítica muestra clics, escaneos QR, leads, ventas y tasa de leads contra el período anterior, con visitas por día, links principales, el embudo de conversiones y desgloses por referente, país, dispositivo, navegador y ciudad. Siguen los filtros, la zona horaria, el CSV y la pestaña Eventos.',
      pt: 'As análises mostram cliques, leituras de QR, leads, vendas e taxa de leads contra o período anterior, com visitas por dia, links principais, o funil de conversões e detalhamento por origem, país, dispositivo, navegador e cidade. Os filtros, o fuso horário, o CSV e a aba Eventos continuam.',
    },
    {
      product: 'social',
      en: 'Analytics compares posts, impressions, reach, engagement, clicks and engagement rate with the previous period, with engagement per day, results by network, a weekday and hour map of when posts get engagement, and tables by post and by account.',
      es: 'La analítica compara publicaciones, impresiones, alcance, interacción, clics y tasa de interacción con el período anterior, con interacción por día, resultados por red, un mapa por día y hora de cuándo interactúan y tablas por publicación y por cuenta.',
      pt: 'As análises comparam publicações, impressões, alcance, interações, cliques e taxa de interação com o período anterior, com interações por dia, resultados por rede, um mapa por dia e hora de quando interagem e tabelas por publicação e por conta.',
    },
  ],
} satisfies ChangelogEntry;
