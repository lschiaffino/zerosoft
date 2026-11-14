import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-track-project-templates',
  date: '2026-11-14',
  title: {
    en: 'Track: project templates',
    es: 'Track: templates de proyectos',
    pt: 'Track: templates de projetos',
  },
  items: [
    {
      product: 'track',
      en: 'Save a project as a template from its … menu, then pick the template when you create a project. The new project gets the description, priority, teams and labels, the milestones with their dates counted from its start date, and the open issues with their milestone, parent and labels. Settings › Project templates lists the templates to rename or delete. Issues from a private team only go into a template when the person saving it can see that team. Creating a project also keeps the name you typed when the form finishes loading. Before, a slow load could clear it.',
      es: 'Guardá un proyecto como template desde su menú … y elegí el template al crear un proyecto. El proyecto nuevo recibe la descripción, la prioridad, los teams y las etiquetas, los milestones con sus fechas contadas desde su inicio y los issues abiertos con su milestone, su padre y sus etiquetas. Ajustes › Templates de proyectos lista los templates para renombrarlos o borrarlos. Los issues de un team privado solo entran en un template si quien lo guarda ve ese team. Al crear un proyecto, además, el nombre tipeado se mantiene cuando el formulario termina de cargar. Antes, una carga lenta lo podía borrar.',
      pt: 'Salve um projeto como template no menu … dele e escolha o template ao criar um projeto. O projeto novo recebe a descrição, a prioridade, os teams e as etiquetas, os milestones com as datas contadas a partir do início e os issues abertos com o milestone, o pai e as etiquetas. Configurações › Templates de projetos lista os templates para renomear ou apagar. Issues de um team privado só entram num template se quem salva vê esse team. Ao criar um projeto, além disso, o nome digitado se mantém quando o formulário termina de carregar. Antes, um carregamento lento podia apagá-lo.',
    },
  ],
} satisfies ChangelogEntry;
