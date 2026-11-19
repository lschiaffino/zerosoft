import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-visibility-consistent',
  date: '2026-11-19',
  title: {
    en: 'Lines: visibility rules applied consistently in Agents and tasks',
    es: 'Lines: las reglas de visibilidad se aplican igual en Agents y en las tareas',
    pt: 'Lines: as regras de visibilidade se aplicam igual no Agents e nas tarefas',
  },
  items: [
    {
      product: 'groups',
      en: 'The rules for who sees each line now apply the same way in the Agents tabs, in tasks created from a chat, in the HubSpot contact link and in the live updates of the inbox. A task created from a message keeps a link to the chat instead of a copy of its text, and Lines shows the message next to the task as before.',
      es: 'Las reglas de quién ve cada línea ahora se aplican igual en las pestañas de Agents, en las tareas creadas desde un chat, en el vínculo de contactos con HubSpot y en las actualizaciones en vivo de la bandeja. Una tarea creada desde un mensaje guarda un vínculo al chat en lugar de una copia de su texto, y Lines muestra el mensaje junto a la tarea como antes.',
      pt: 'As regras de quem vê cada linha agora se aplicam igual nas abas do Agents, nas tarefas criadas a partir de um chat, no vínculo de contatos com o HubSpot e nas atualizações ao vivo da caixa de entrada. Uma tarefa criada a partir de uma mensagem guarda um vínculo com o chat em vez de uma cópia do texto, e o Lines mostra a mensagem junto à tarefa como antes.',
    },
  ],
} satisfies ChangelogEntry;
