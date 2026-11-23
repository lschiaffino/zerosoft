import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-2000-crm-dashboards-polish',
  date: '2026-11-22',
  title: {
    en: 'CRM: clearer dashboards and drill-down on custom reports',
    es: 'CRM: dashboards más claros y detalle de registros en reportes propios',
    pt: 'CRM: dashboards mais claros e detalhe dos registros em relatórios próprios',
  },
  items: [
    {
      product: 'crm',
      en: 'Each KPI now shows its change against the previous period with an arrow and the previous value next to it. Sales velocity uses the standard formula (open deals × win rate × average deal size ÷ sales cycle) and compares with the deals that were open at the end of the previous period. The conversion funnel lines its stages up on the left with the conversion between each step, reports in a row share the same height, won and lost by owner and activities by rep draw as columns with a single legend, and months carry the year when a range spans two years. The dashboard name, who can see it and the actions sit on one row, with owner and team filters always in view. Custom reports on a dashboard follow its date range when they have a date field, and clicking a bar, slice or row lists its records.',
      es: 'Cada KPI muestra ahora su cambio contra el período anterior con una flecha y el valor anterior al lado. La velocidad de ventas usa la fórmula estándar (deals abiertos × tasa de cierre × ticket promedio ÷ ciclo de venta) y se compara con los deals que estaban abiertos al cierre del período anterior. El embudo de conversión alinea las etapas a la izquierda con la conversión entre un paso y el siguiente, los reportes de una fila miden lo mismo, ganados y perdidos por propietario y actividades por vendedor se dibujan como columnas con una sola leyenda, y los meses llevan el año cuando el rango cruza dos años. El nombre del dashboard, quién lo ve y las acciones van en una sola fila, con los filtros de propietario y equipo siempre a la vista. Los reportes propios en un dashboard siguen su rango de fechas cuando tienen un campo de fecha, y un clic en una barra, porción o fila lista sus registros.',
      pt: 'Cada KPI agora mostra a variação contra o período anterior com uma seta e o valor anterior ao lado. A velocidade de vendas usa a fórmula padrão (negócios abertos × taxa de ganho × ticket médio ÷ ciclo de venda) e se compara com os negócios que estavam abertos no fim do período anterior. O funil de conversão alinha as etapas à esquerda com a conversão entre um passo e o seguinte, os relatórios de uma linha têm a mesma altura, ganhos e perdidos por proprietário e atividades por vendedor aparecem como colunas com uma só legenda, e os meses levam o ano quando o período cruza dois anos. O nome do dashboard, quem pode vê-lo e as ações ficam numa só linha, com os filtros de proprietário e equipe sempre à vista. Os relatórios próprios num dashboard seguem o período quando têm um campo de data, e um clique numa barra, fatia ou linha lista os registros.',
    },
  ],
} satisfies ChangelogEntry;
