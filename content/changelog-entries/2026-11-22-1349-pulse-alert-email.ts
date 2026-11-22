import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-pulse-alert-email',
  date: '2026-11-22',
  title: {
    en: 'Pulse: alerts by email',
    es: 'Pulse: alertas por email',
    pt: 'Pulse: alertas por email',
  },
  items: [
    {
      product: 'pulse',
      en: 'An alert on a trends insight can also send an email when it starts firing, with the value and a link to the insight. The box is on when you add an alert, and each alert has its own Email switch in the insight. It goes to the people subscribed to the alert who still have Pulse in the workspace, once until the alert clears, and at most 60 alert emails per workspace per hour.',
      es: 'Una alerta sobre un insight de tendencias también puede mandar un email cuando se dispara, con el valor y el link al insight. La casilla viene marcada al sumar una alerta, y cada alerta tiene su propio Email en el insight. Le llega a quienes están suscriptos a la alerta y siguen teniendo Pulse en el workspace, una vez hasta que se normaliza, y como mucho 60 emails de alertas por workspace por hora.',
      pt: 'Um alerta sobre um insight de tendências também pode enviar um email quando dispara, com o valor e o link para o insight. A caixa vem marcada ao adicionar um alerta, e cada alerta tem seu próprio Email no insight. Chega para quem está inscrito no alerta e ainda tem o Pulse no workspace, uma vez até normalizar, e no máximo 60 emails de alertas por workspace por hora.',
    },
  ],
} satisfies ChangelogEntry;
