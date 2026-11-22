import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-0815-crm-tasks-queues-reminders',
  date: '2026-11-22',
  title: {
    en: 'CRM: tasks as a table, named task queues and reminders',
    es: 'CRM: tareas como tabla, colas de tareas con nombre y recordatorios',
    pt: 'CRM: tarefas como tabela, filas de tarefas com nome e lembretes',
  },
  items: [
    {
      product: 'crm',
      en: 'The Tasks page is now a table with the views All, Due today, Overdue, Upcoming and Completed, plus saved views you can keep private or share. Filter by type, priority, owner, queue, project or text, sort by title, priority or due date, and choose the columns. Select tasks to change their owner, priority, due date, type, queue or project at once, or to complete, reopen or delete them. Create named queues, private or shared with the workspace, put tasks in them and work them one after another, or start the work queue with exactly what the current view shows. A task can carry a reminder at the due time or before it: the person assigned gets a notification and an email. Each person can also turn on a daily email at 8 with their open tasks that are overdue or due today. Everything follows the same access rules as the rest of the CRM: you only see, change or get reminded about tasks on records you can see.',
      es: 'La página de Tareas ahora es una tabla con las vistas Todas, Vencen hoy, Vencidas, Próximas y Completadas, más vistas guardadas que podés dejar privadas o compartir. Filtrá por tipo, prioridad, owner, cola, proyecto o texto, ordená por título, prioridad o vencimiento, y elegí las columnas. Elegí tareas para cambiarles de una vez el owner, la prioridad, el vencimiento, el tipo, la cola o el proyecto, o para completarlas, reabrirlas o borrarlas. Creá colas con nombre, privadas o compartidas con el workspace, poné tareas en ellas y trabajalas una detrás de otra, o empezá la cola de trabajo con justo lo que muestra la vista. Una tarea puede llevar un recordatorio a la hora del vencimiento o antes: la persona asignada recibe un aviso y un email. Cada persona también puede activar un email diario a las 8 con sus tareas abiertas vencidas o que vencen hoy. Todo sigue las mismas reglas de acceso que el resto del CRM: solo ves, cambiás o te avisan de tareas de registros que podés ver.',
      pt: 'A página de Tarefas agora é uma tabela com as visualizações Todas, Vencem hoje, Vencidas, Próximas e Concluídas, mais visualizações salvas que você pode deixar privadas ou compartilhar. Filtre por tipo, prioridade, responsável, fila, projeto ou texto, ordene por título, prioridade ou vencimento, e escolha as colunas. Selecione tarefas para mudar de uma vez o responsável, a prioridade, o vencimento, o tipo, a fila ou o projeto, ou para concluí-las, reabri-las ou excluí-las. Crie filas com nome, privadas ou compartilhadas com o workspace, coloque tarefas nelas e trabalhe uma depois da outra, ou comece a fila de trabalho com exatamente o que a visualização mostra. Uma tarefa pode ter um lembrete na hora do vencimento ou antes: a pessoa atribuída recebe um aviso e um email. Cada pessoa também pode ativar um email diário às 8 com suas tarefas abertas vencidas ou que vencem hoje. Tudo segue as mesmas regras de acesso do resto do CRM: você só vê, altera ou recebe avisos de tarefas de registros que pode ver.',
    },
  ],
} satisfies ChangelogEntry;
