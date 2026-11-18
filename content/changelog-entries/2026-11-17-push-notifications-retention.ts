import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-push-notifications-retention',
  date: '2026-11-17',
  title: {
    en: 'Push notifications no longer keep the message text',
    es: 'Los avisos push ya no guardan el texto del mensaje',
    pt: 'As notificações push não guardam mais o texto da mensagem',
  },
  items: [
    {
      product: 'groups',
      en: 'The text shown in a browser notification is deleted as soon as your browser picks it up. A notification nobody picks up is deleted after 24 hours.',
      es: 'El texto que muestra un aviso del navegador se borra apenas tu navegador lo recibe. Un aviso que nadie recibe se borra a las 24 horas.',
      pt: 'O texto mostrado numa notificação do navegador é apagado assim que o seu navegador a recebe. Uma notificação que ninguém recebe é apagada depois de 24 horas.',
    },
    {
      product: 'talk',
      en: 'Talk notifications follow the same rule: the text is deleted once delivered, or after 24 hours.',
      es: 'Los avisos de Talk siguen la misma regla: el texto se borra al entregarse o a las 24 horas.',
      pt: 'As notificações do Talk seguem a mesma regra: o texto é apagado ao ser entregue ou depois de 24 horas.',
    },
  ],
} satisfies ChangelogEntry;
