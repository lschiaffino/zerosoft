import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0221-crm-outlook-private-events',
  date: '2026-11-20',
  title: {
    en: 'CRM: Outlook events marked private stay off the contact timeline',
    es: 'CRM: los eventos de Outlook marcados como privados no van al timeline del contacto',
    pt: 'CRM: eventos do Outlook marcados como particulares não vão para a linha do tempo do contato',
  },
  items: [
    {
      product: 'crm',
      en: 'With Outlook connected, a calendar event with a CRM contact as a guest becomes a meeting on that contact, which the rest of the team can see. Events you mark as private or confidential in Outlook are now left out, and a meeting already synced leaves the timeline once you mark it private.',
      es: 'Con Outlook conectado, un evento del calendario con un contacto del CRM como invitado se vuelve una reunión en ese contacto, que ve el resto del equipo. Ahora los eventos que marcás como privados o confidenciales en Outlook quedan afuera, y una reunión ya sincronizada sale del timeline cuando la marcás como privada.',
      pt: 'Com o Outlook conectado, um evento da agenda com um contato do CRM como convidado vira uma reunião nesse contato, que o resto da equipe vê. Agora os eventos que você marca como particulares ou confidenciais no Outlook ficam de fora, e uma reunião já sincronizada sai da linha do tempo quando você a marca como particular.',
    },
  ],
} satisfies ChangelogEntry;
