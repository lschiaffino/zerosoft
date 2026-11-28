import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-daily-brief',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: your daily brief',
    es: 'Lines e Inbox: tu resumen del día',
    pt: 'Lines e Inbox: seu resumo do dia',
  },
  items: [
    {
      product: 'groups',
      en: 'A card at the top of the Lines inbox shows what is waiting on you today: chats assigned to you that wait for a reply, unassigned groups without an answer, tickets close to their SLA, new tickets, your tasks for today and mentions in internal notes. It only counts chats you can see, and each row takes you there. Hide it until tomorrow with the close button; it updates when you come back to the tab.',
      es: 'Una tarjeta arriba de la bandeja de Lines muestra lo que te espera hoy: chats asignados a vos que esperan respuesta, grupos sin asignar sin respuesta, tickets cerca de su SLA, tickets nuevos, tus tareas de hoy y menciones en notas internas. Solo cuenta chats que ves, y cada fila te lleva ahí. Se oculta hasta mañana con el botón de cerrar y se actualiza cuando volvés a la pestaña.',
      pt: 'Um cartão no topo da caixa do Lines mostra o que espera por você hoje: conversas atribuídas a você esperando resposta, grupos sem atribuição sem resposta, tickets perto do SLA, tickets novos, suas tarefas de hoje e menções em notas internas. Só conta conversas que você vê, e cada linha leva até lá. Dá para ocultar até amanhã com o botão de fechar, e ele se atualiza quando você volta para a aba.',
    },
    {
      product: 'inbox',
      en: 'Inbox shows its own brief: chats to reply (people marked as internal don\'t count), reminders due, groups with unread messages and mentions of you in groups. Turn on Settings › Notifications › Daily brief to get both by email every morning, around 8:00 in your time zone and only on days with something waiting.',
      es: 'Inbox muestra su propio resumen: chats por responder (sin las personas marcadas como internas), recordatorios vencidos, grupos con mensajes sin leer y menciones a vos en grupos. Prendé Ajustes › Avisos › Resumen del día para recibir los dos por email cada mañana, cerca de las 8:00 en tu zona horaria y solo los días con algo pendiente.',
      pt: 'O Inbox mostra seu próprio resumo: conversas para responder (sem as pessoas marcadas como internas), lembretes vencidos, grupos com mensagens não lidas e menções a você em grupos. Ligue Ajustes › Avisos › Resumo do dia para receber os dois por e-mail toda manhã, por volta das 8:00 no seu fuso horário e só nos dias com algo pendente.',
    },
  ],
} satisfies ChangelogEntry;
