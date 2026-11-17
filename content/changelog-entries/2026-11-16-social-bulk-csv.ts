import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-social-bulk-csv',
  date: '2026-11-16',
  title: {
    en: 'Social: schedule up to 350 posts from a CSV',
    es: 'Social: programá hasta 350 publicaciones desde un CSV',
    pt: 'Social: agende até 350 publicações a partir de um CSV',
  },
  items: [
    {
      product: 'social',
      en: 'Posts has a new Import CSV button. Pick the accounts, choose a file or paste the rows (date, time, text and an optional link, with or without a header in English, Spanish or Portuguese), and every row shows up in a preview with its date in your time zone. Rows with a date that already passed, a date we can\'t read, a broken link or text that is too long for one of the networks are marked and skipped, and the button says how many. Files exported by Excel with semicolons work too, and dates like 03/04/2026 are read day first or month first, as you choose. You can import as scheduled posts or as drafts; people who need approval send them for approval. Up to 350 rows per file, sent in batches with the progress in view.',
      es: 'Publicaciones tiene un botón nuevo, Importar CSV. Elegís las cuentas, cargás un archivo o pegás las filas (fecha, hora, texto y un link opcional, con o sin encabezado en español, inglés o portugués), y cada fila aparece en una vista previa con su fecha en tu zona horaria. Las filas con una fecha que ya pasó, una fecha que no se entiende, un link roto o un texto demasiado largo para alguna de las redes quedan marcadas y se saltean, y el botón dice cuántas. También sirven los archivos de Excel con punto y coma, y las fechas como 03/04/2026 se leen con el día o el mes primero, como elijas. Podés importar como publicaciones programadas o como borradores; quien necesita aprobación las manda a aprobar. Hasta 350 filas por archivo, que se mandan en tandas con el avance a la vista.',
      pt: 'Publicações tem um botão novo, Importar CSV. Escolha as contas, carregue um arquivo ou cole as linhas (data, hora, texto e um link opcional, com ou sem cabeçalho em português, inglês ou espanhol), e cada linha aparece numa prévia com a data no seu fuso horário. Linhas com uma data que já passou, uma data ilegível, um link quebrado ou um texto longo demais para alguma das redes ficam marcadas e são puladas, e o botão diz quantas. Arquivos do Excel com ponto e vírgula também funcionam, e datas como 03/04/2026 são lidas com o dia ou o mês primeiro, como você escolher. Dá para importar como publicações agendadas ou como rascunhos; quem precisa de aprovação envia para aprovar. Até 350 linhas por arquivo, enviadas em lotes com o progresso à vista.',
    },
  ],
} satisfies ChangelogEntry;
