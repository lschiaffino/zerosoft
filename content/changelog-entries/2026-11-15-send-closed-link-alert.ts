import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-send-closed-link-alert',
  date: '2026-11-15',
  title: {
    en: 'Send: know when someone opens a disabled or expired link',
    es: 'Send: enterate cuando alguien abre un link deshabilitado o vencido',
    pt: 'Send: saiba quando alguém abre um link desativado ou expirado',
  },
  items: [
    {
      product: 'send',
      en: 'When someone opens a link you disabled, or one that expired, you get a notice in the bell and by email, with their email if they had entered one before. It counts once a day per person, link previews and bots are left out, and it follows the link setting for notices. The attempt also shows in the document activity, even before the first visit.',
      es: 'Cuando alguien abre un link que deshabilitaste, o uno que venció, te llega un aviso en la campana y por email, con su email si lo había escrito antes. Cuenta una vez por día por persona, las vistas previas de links y los bots quedan afuera, y respeta la opción de avisos del link. El intento también aparece en la actividad del documento, aunque todavía no haya visitas.',
      pt: 'Quando alguém abre um link que você desativou, ou um que expirou, você recebe um aviso no sino e por email, com o email da pessoa se ela o tinha digitado antes. Conta uma vez por dia por pessoa, prévias de links e bots ficam de fora, e segue a opção de avisos do link. A tentativa também aparece na atividade do documento, mesmo antes da primeira visita.',
    },
  ],
} satisfies ChangelogEntry;
