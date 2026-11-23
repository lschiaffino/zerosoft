import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-2200-crm-lists-select-all-picker',
  date: '2026-11-22',
  title: {
    en: 'CRM: select every record in a view, bulk tasks and a searchable association picker',
    es: 'CRM: elegir todos los registros de una vista, tareas en masa y un selector de asociaciones con búsqueda',
    pt: 'CRM: selecionar todos os registros de uma visualização, tarefas em massa e um seletor de associações com busca',
  },
  items: [
    {
      product: 'crm',
      en: 'Contacts, companies and deals now share one toolbar and one table. After selecting the page, Select all in this view takes every matching record (up to 1,000 per action) for Assign, Edit, Tags, Create tasks, Export and Delete. Create tasks adds one task per record for its owner or for you. Export view downloads the whole filtered view as CSV (admins). Edit quick filters chooses which filters the row shows, saved with the view, and Last activity has a No activity option. Each column header has a menu to sort, move or remove the column, and a wide table scrolls inside its frame with a shadow on the side that has more. Lifecycle stage, lead status and priority show as plain text with a dot. On the record page, Highlights use one type scale, long emails end in an ellipsis, and association cards have + Add, which searches every record you can see and can create a new one.',
      es: 'Contactos, empresas y deals ahora comparten una barra y una tabla. Después de elegir la página, Elegir todos los de esta vista toma todos los registros que coinciden (hasta 1.000 por acción) para Asignar, Editar, Tags, Crear tareas, Exportar y Eliminar. Crear tareas agrega una tarea por registro para su responsable o para vos. Exportar vista baja en CSV toda la vista filtrada (admins). Editar filtros rápidos elige qué filtros muestra la fila, y se guarda con la vista; Última actividad tiene la opción Sin actividad. Cada encabezado de columna tiene un menú para ordenar, mover o quitar la columna, y una tabla ancha se desplaza dentro de su marco con una sombra del lado que tiene más. La etapa del ciclo de vida, el estado del lead y la prioridad se ven como texto con un punto. En la ficha, Destacados usa una sola escala de texto, los emails largos terminan en puntos suspensivos y las tarjetas de asociaciones tienen + Agregar, que busca entre todos los registros que ves y puede crear uno nuevo.',
      pt: 'Contatos, empresas e negócios agora compartilham uma barra e uma tabela. Depois de escolher a página, Selecionar todos desta visualização pega todos os registros que coincidem (até 1.000 por ação) para Atribuir, Editar, Tags, Criar tarefas, Exportar e Excluir. Criar tarefas adiciona uma tarefa por registro para o responsável ou para você. Exportar visualização baixa em CSV toda a visualização filtrada (admins). Editar filtros rápidos escolhe quais filtros a linha mostra, salvo com a visualização, e Última atividade tem a opção Sem atividade. Cada cabeçalho de coluna tem um menu para ordenar, mover ou remover a coluna, e uma tabela larga rola dentro do seu quadro com uma sombra do lado que tem mais. Estágio do ciclo de vida, status do lead e prioridade aparecem como texto com um ponto. No registro, Destaques usa uma só escala de texto, emails longos terminam em reticências e os cartões de associações têm + Adicionar, que busca entre todos os registros que você vê e pode criar um novo.',
    },
  ],
} satisfies ChangelogEntry;
