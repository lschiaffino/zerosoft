import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-priority-inbox-time-in-status',
  date: '2026-11-23',
  title: {
    en: 'Track: Priority inbox and time in status',
    es: 'Track: Inbox con Prioridad y tiempo en el estado',
    pt: 'Track: Inbox com Prioridade e tempo no status',
  },
  items: [
    {
      product: 'track',
      en: 'The inbox has two tabs, Priority and Other, each with its unread count. Priority holds what is assigned to you, mentions, triage and SLAs waiting on you, your reminders, and status or priority changes on issues you follow; the rest goes to Other. Each notification shows who did it with an icon for the action, the issue with its current title and status, and a gray line saying why it reached you. From the keyboard: J and K move, Enter opens, U marks read or unread, H snoozes and Backspace deletes. You only see notifications for issues you can open today.',
      es: 'El inbox tiene dos pestañas, Prioridad y Otras, cada una con sus sin leer. En Prioridad va lo que te asignaron, las menciones, el triage y los SLAs que esperan tu acción, tus recordatorios y los cambios de estado o prioridad en issues que seguís; el resto va a Otras. Cada aviso muestra quién lo hizo con un ícono de la acción, el issue con su título y estado actuales, y una línea gris que dice por qué te llegó. Con el teclado: J y K para moverte, Enter abre, U marca leído o sin leer, H pospone y Backspace borra. Solo ves avisos de issues que hoy podés abrir.',
      pt: 'O inbox tem duas abas, Prioridade e Outras, cada uma com as não lidas. Em Prioridade fica o que foi atribuído a você, as menções, a triagem e os SLAs que esperam sua ação, seus lembretes e as mudanças de status ou prioridade em issues que você segue; o resto vai para Outras. Cada aviso mostra quem fez com um ícone da ação, o issue com título e status atuais, e uma linha cinza dizendo por que chegou. Pelo teclado: J e K para mover, Enter abre, U marca lido ou não lido, H adia e Backspace exclui. Você só vê avisos de issues que pode abrir hoje.',
    },
    {
      product: 'track',
      en: 'Time in status: every status change is now recorded, including those from the API, bulk edits and importers, and older issues were rebuilt from their activity. The issue shows how long it has been in its current status and, when you open it, the total time in each status. In lists and boards it is a display property, an ordering and a filter (more or less than N days), and Insights has it as a measure. Display also gained Updated, Estimate, Links and Milestone, shown as a small icon and text at the right of each row.',
      es: 'Tiempo en el estado: ahora queda registrado cada cambio de estado, también los de la API, la edición masiva y los importadores, y los issues anteriores se reconstruyeron con su actividad. El issue muestra cuánto lleva en su estado actual y, al abrirlo, el tiempo total en cada estado. En listas y tableros es una propiedad, un orden y un filtro (más o menos de N días), e Insights lo tiene como medida. Display suma además Editado, Estimación, Links y Milestone, con un ícono y texto chico a la derecha de cada fila.',
      pt: 'Tempo no status: agora cada mudança de status fica registrada, também as da API, da edição em massa e dos importadores, e os issues anteriores foram reconstruídos pela atividade. O issue mostra há quanto tempo está no status atual e, ao abrir, o tempo total em cada status. Em listas e quadros é uma propriedade, uma ordenação e um filtro (mais ou menos de N dias), e o Insights tem como medida. O Display ganhou também Atualizado, Estimativa, Links e Milestone, com um ícone e texto pequeno à direita de cada linha.',
    },
  ],
} satisfies ChangelogEntry;
