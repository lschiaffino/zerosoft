import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-sign-reminded-date',
  date: '2026-11-20',
  title: {
    en: 'Sign: see when each recipient was last reminded',
    es: 'Sign: mirá cuándo se le recordó por última vez a cada destinatario',
    pt: 'Sign: veja quando cada destinatário foi lembrado pela última vez',
  },
  items: [
    {
      product: 'sign',
      en: 'In an envelope that is out for signature, each recipient now shows the date of the last reminder, whether you sent it or the automatic one did.',
      es: 'En un sobre enviado a firmar, cada destinatario muestra la fecha del último recordatorio, ya sea el que mandaste vos o el automático.',
      pt: 'Num envelope enviado para assinatura, cada destinatário mostra a data do último lembrete, seja o que você enviou ou o automático.',
    },
  ],
} satisfies ChangelogEntry;
