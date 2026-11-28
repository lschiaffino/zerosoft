import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-1713-crm-record-phone-tidy',
  date: '2026-11-28',
  title: {
    en: 'CRM: a tidier record page on a phone',
    es: 'CRM: la ficha más prolija en el teléfono',
    pt: 'CRM: a página do registro mais organizada no celular',
  },
  items: [
    {
      product: 'crm',
      en: 'On a phone, the feedback tab no longer covers the record page (send feedback from the account menu). In the timeline, an automatic lifecycle change is marked with a dot instead of an arrow, so it no longer looks like something you can open.',
      es: 'En el teléfono, la pestaña de feedback ya no tapa la ficha (el feedback se manda desde el menú de la cuenta). En el timeline, un cambio automático de lifecycle se marca con un punto en lugar de una flecha, así no parece algo que se abre.',
      pt: 'No celular, a aba de feedback não cobre mais a página do registro (o feedback é enviado pelo menu da conta). No timeline, uma mudança automática de lifecycle é marcada com um ponto em vez de uma seta, para não parecer algo que se abre.',
    },
  ],
} satisfies ChangelogEntry;
