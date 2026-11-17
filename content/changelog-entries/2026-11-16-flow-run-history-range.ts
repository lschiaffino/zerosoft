import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-flow-run-history-range',
  date: '2026-11-16',
  title: {
    en: 'Flow: the run history shows the range you pick',
    es: 'Flow: el historial de corridas muestra el rango que elegís',
    pt: 'Flow: o histórico de execuções mostra o período que você escolhe',
  },
  items: [
    {
      product: 'flow',
      en: 'In Run history, going back to the range the page opened with (for example 7 days, then 30, then 7 again) now loads that range. Before, the numbers and the chart kept the last range you picked. The chart shows the first and last date, says "No runs in this range" instead of an empty box, and keeps its bars visible at 90 days on a phone.',
      es: 'En el historial de corridas, volver al rango con el que abrió la página (por ejemplo 7 días, después 30 y otra vez 7) ahora carga ese rango. Antes los números y el gráfico se quedaban con el último rango elegido. El gráfico muestra la primera y la última fecha, dice "Sin corridas en este rango" en lugar de un recuadro vacío y sus barras se ven a 90 días en el teléfono.',
      pt: 'No histórico de execuções, voltar ao período com que a página abriu (por exemplo 7 dias, depois 30 e 7 de novo) agora carrega esse período. Antes os números e o gráfico ficavam com o último período escolhido. O gráfico mostra a primeira e a última data, diz "Nenhuma execução neste período" em vez de um quadro vazio e as barras aparecem com 90 dias no celular.',
    },
  ],
} satisfies ChangelogEntry;
