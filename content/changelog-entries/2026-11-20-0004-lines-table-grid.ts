import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0004-lines-table-grid',
  date: '2026-11-20',
  title: {
    en: 'Lines: the Groups and Contacts tables keep their header in view, and you edit groups in the cell',
    es: 'Lines: las tablas de Grupos y Contactos dejan la cabecera a la vista, y los grupos se editan en la celda',
    pt: 'Lines: as tabelas de Grupos e Contatos mantêm o cabeçalho à vista, e os grupos são editados na célula',
  },
  items: [
    {
      product: 'groups',
      en: 'In Groups and Contacts the table scrolls in its own box: the header row stays at the top, and the checkbox and the name stay on the left while you scroll sideways through many columns. Arrow keys move between cells.',
      es: 'En Grupos y Contactos la tabla scrollea en su propia caja: la fila de títulos queda arriba, y la casilla y el nombre quedan a la izquierda mientras corrés de costado entre muchas columnas. Las flechas pasan de una celda a otra.',
      pt: 'Em Grupos e Contatos a tabela rola na sua própria caixa: a linha de títulos fica no topo, e a caixa de seleção e o nome ficam à esquerda enquanto você rola de lado entre muitas colunas. As setas passam de uma célula para outra.',
    },
    {
      product: 'groups',
      en: 'In Groups, click a cell to change labels, status, zerosoft properties and HubSpot company properties in place. HubSpot values are written to HubSpot right away, with the same permissions as the HubSpot panel of the chat. Enter or clicking outside saves, Esc cancels and Tab saves and moves to the next cell. If a save fails, the old value comes back with the reason. Read-only cells say why in their tooltip, for example when the HubSpot connection can only read.',
      es: 'En Grupos, un clic en la celda cambia ahí mismo etiquetas, estado, propiedades de zerosoft y propiedades de la empresa en HubSpot. Los valores de HubSpot se escriben en HubSpot en el momento, con los mismos permisos que el panel de HubSpot del chat. Enter o un clic afuera guardan, Esc cancela y Tab guarda y pasa a la celda siguiente. Si no se puede guardar, vuelve el valor anterior con el motivo. Las celdas de solo lectura dicen por qué en su tooltip, por ejemplo cuando la conexión con HubSpot solo puede leer.',
      pt: 'Em Grupos, um clique na célula muda ali mesmo etiquetas, status, propriedades do zerosoft e propriedades da empresa no HubSpot. Os valores do HubSpot são gravados no HubSpot na hora, com as mesmas permissões do painel do HubSpot da conversa. Enter ou um clique fora salvam, Esc cancela e Tab salva e passa para a célula seguinte. Se não der para salvar, o valor anterior volta com o motivo. As células somente leitura dizem por quê na dica, por exemplo quando a conexão com o HubSpot só pode ler.',
    },
  ],
} satisfies ChangelogEntry;
