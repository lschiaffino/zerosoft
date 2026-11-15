import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-lines-groups-table',
  date: '2026-11-15',
  title: {
    en: 'Lines: a groups table you can shape, with HubSpot columns',
    es: 'Lines: una tabla de grupos a tu medida, con columnas de HubSpot',
    pt: 'Lines: uma tabela de grupos do seu jeito, com colunas do HubSpot',
  },
  items: [
    {
      product: 'groups',
      en: 'In Groups you choose which columns to see, including any property of the linked HubSpot company, sort by any column and filter by one, several or all lines. Each row shows the HubSpot company with a link to open it there.',
      es: 'En Grupos elegís qué columnas ver, también cualquier propiedad de la empresa de HubSpot vinculada, ordenás por cualquier columna y filtrás por una, varias o todas las líneas. Cada fila muestra la empresa de HubSpot con un link para abrirla allá.',
      pt: 'Em Grupos você escolhe quais colunas ver, inclusive qualquer propriedade da empresa do HubSpot vinculada, ordena por qualquer coluna e filtra por uma, várias ou todas as linhas. Cada linha mostra a empresa do HubSpot com um link para abri-la lá.',
    },
    {
      product: 'groups',
      en: 'The table also shows the company owner, the linked HubSpot deal and its stage. Admins add their own columns from Columns, and anyone who can write fills them in right in the cell: the value is saved on every line the group is in.',
      es: 'La tabla también muestra el dueño de la empresa, el negocio de HubSpot vinculado y su etapa. Los admins agregan columnas propias desde Columnas y quien puede escribir las completa en la misma celda: el valor queda en todas las líneas donde está el grupo.',
      pt: 'A tabela também mostra o dono da empresa, o negócio do HubSpot vinculado e a etapa dele. Admins adicionam colunas próprias em Colunas e quem pode escrever preenche direto na célula: o valor fica em todas as linhas em que o grupo está.',
    },
    {
      product: 'groups',
      en: 'A WhatsApp group that several of your lines are in is now one row that says which lines it is in. It has one HubSpot company: linking or unlinking it from any line changes it for all of them, and a line that joins later gets it too.',
      es: 'Un grupo de WhatsApp en el que están varias de tus líneas ahora es una sola fila que dice en qué líneas está. Tiene una sola empresa de HubSpot: vincularla o quitarla desde cualquier línea la cambia en todas, y una línea que entra después también la recibe.',
      pt: 'Um grupo de WhatsApp em que estão várias das suas linhas agora é uma só linha da tabela que mostra em quais linhas está. Ele tem uma só empresa do HubSpot: vincular ou remover a partir de qualquer linha muda em todas, e uma linha que entra depois também a recebe.',
    },
  ],
} satisfies ChangelogEntry;
