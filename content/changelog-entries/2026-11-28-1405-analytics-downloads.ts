import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-analytics-downloads',
  date: '2026-11-28',
  title: {
    en: 'Analytics: download results as Excel and JSON, up to 20,000 rows',
    es: 'Analytics: descargá resultados en Excel y JSON, hasta 20.000 filas',
    pt: 'Analytics: baixe resultados em Excel e JSON, até 20.000 linhas',
  },
  items: [
    {
      product: 'analytics',
      en: 'Every result now downloads as CSV, Excel (.xlsx) or JSON, from a table, a number, a chart or a dashboard card. The Excel file keeps numbers as numbers and dates as dates, with the header in bold and pinned. If the screen shows only the first 2,000 rows, the download runs the query again and brings up to 20,000. The file takes the question\'s name. The API does the same with a format field on a query or a saved question.',
      es: 'Cada resultado se descarga en CSV, Excel (.xlsx) o JSON, desde una tabla, un número, un gráfico o una tarjeta del tablero. El Excel guarda los números como números y las fechas como fechas, con el encabezado en negrita y fijo. Si la pantalla muestra solo las primeras 2.000 filas, la descarga vuelve a correr la consulta y trae hasta 20.000. El archivo lleva el nombre de la pregunta. La API hace lo mismo con un campo format en una consulta o una pregunta guardada.',
      pt: 'Cada resultado pode ser baixado em CSV, Excel (.xlsx) ou JSON, a partir de uma tabela, um número, um gráfico ou um cartão do painel. O Excel guarda números como números e datas como datas, com o cabeçalho em negrito e fixo. Se a tela mostra só as primeiras 2.000 linhas, o download roda a consulta de novo e traz até 20.000. O arquivo leva o nome da pergunta. A API faz o mesmo com um campo format numa consulta ou numa pergunta salva.',
    },
  ],
} satisfies ChangelogEntry;
