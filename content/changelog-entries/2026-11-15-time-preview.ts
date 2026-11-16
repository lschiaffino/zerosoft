import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-time-preview',
  date: '2026-11-15',
  title: {
    en: 'Time: track hours by project, in internal preview',
    es: 'Time: registro de horas por proyecto, en vista previa interna',
    pt: 'Time: registro de horas por projeto, em prévia interna',
  },
  items: [
    {
      product: 'time',
      en: 'A new app to track hours, an alternative to Harvest. Start a timer or type 1:30, 1.5 or 90m against a project and a task, and see the week with a total per day. Projects carry a client, a code, an hourly rate and a budget in hours. Reports show hours, billable hours and amount by project, client, task or person for any range, and export to CSV. Members see their own hours; owners and admins see the whole team. It is still in internal preview: it opens for customers once it is ready.',
      es: 'Una app nueva para registrar horas, alternativa a Harvest. Arrancá un cronómetro o escribí 1:30, 1,5 o 90m contra un proyecto y una tarea, y mirá la semana con el total de cada día. Los proyectos llevan cliente, código, tarifa por hora y presupuesto en horas. Los reportes muestran horas, horas facturables y monto por proyecto, cliente, tarea o persona en cualquier rango, y se bajan en CSV. Los miembros ven sus horas; dueños y admins, las de todo el equipo. Todavía está en vista previa interna: se abre a los clientes cuando esté lista.',
      pt: 'Um app novo para registrar horas, alternativa ao Harvest. Inicie um cronômetro ou digite 1:30, 1,5 ou 90m contra um projeto e uma tarefa, e veja a semana com o total de cada dia. Os projetos têm cliente, código, valor por hora e orçamento em horas. Os relatórios mostram horas, horas faturáveis e valor por projeto, cliente, tarefa ou pessoa em qualquer período, e exportam em CSV. Os membros veem as próprias horas; donos e admins, as de toda a equipe. Ainda está em prévia interna: abre para os clientes quando estiver pronto.',
    },
  ],
} satisfies ChangelogEntry;
