import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-analytics-track-send-forms',
  date: '2026-11-17',
  title: {
    en: 'Track, Send and Forms: analytics with the same layout as Lines',
    es: 'Track, Send y Forms: analítica con el mismo formato que Lines',
    pt: 'Track, Send e Forms: análises com o mesmo formato do Lines',
  },
  items: [
    {
      product: 'track',
      en: 'New Analytics page: issues created and completed against the previous period, median cycle time and lead time, open issues right now, created and completed per day, results by team, when issues get done and a table by person. Filter by team. Insights stays for custom charts.',
      es: 'Nueva página de Analítica: issues creados y terminados contra el período anterior, mediana del tiempo de ciclo y del tiempo total, issues abiertos ahora, creados y terminados por día, resultados por equipo, cuándo se terminan y una tabla por persona. Filtro por equipo. Insights sigue para los gráficos a medida.',
      pt: 'Nova página de Análises: issues criados e concluídos contra o período anterior, mediana do tempo de ciclo e do tempo total, issues abertos agora, criados e concluídos por dia, resultados por equipe, quando são concluídos e uma tabela por pessoa. Filtro por equipe. Insights continua para gráficos personalizados.',
    },
    {
      product: 'send',
      en: 'New Analytics page for all your documents: visits, people, time per visit, share of pages read and downloads against the previous period, visits per day, by document, when people open them, countries, devices and a table by document. Filter by document.',
      es: 'Nueva página de Analítica de todos tus documentos: visitas, personas, tiempo por visita, parte de las páginas leídas y descargas contra el período anterior, visitas por día, por documento, cuándo los abren, países, dispositivos y una tabla por documento. Filtro por documento.',
      pt: 'Nova página de Análises de todos os seus documentos: visitas, pessoas, tempo por visita, parte das páginas lidas e downloads contra o período anterior, visitas por dia, por documento, quando abrem, países, dispositivos e uma tabela por documento. Filtro por documento.',
    },
    {
      product: 'forms',
      en: 'New Analytics page for all your forms: views, responses, completion rate and partial responses against the previous period, views and responses per day, by form, when responses arrive and a table by form. Filter by form.',
      es: 'Nueva página de Analítica de todos tus formularios: visitas, respuestas, tasa de finalización y respuestas a medias contra el período anterior, visitas y respuestas por día, por formulario, cuándo llegan y una tabla por formulario. Filtro por formulario.',
      pt: 'Nova página de Análises de todos os seus formulários: visitas, respostas, taxa de conclusão e respostas parciais contra o período anterior, visitas e respostas por dia, por formulário, quando chegam e uma tabela por formulário. Filtro por formulário.',
    },
  ],
} satisfies ChangelogEntry;
