import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-scheduled-quiet',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: calmer scheduled messages bar',
    es: 'Inbox y Lines: la barra de mensajes programados, más tranquila',
    pt: 'Inbox e Lines: barra de mensagens agendadas mais discreta',
  },
  items: [
    {
      product: 'inbox',
      en: 'Above the composer, the send time and the Edit, Send now and Cancel actions are now small and regular weight, so the message itself stands out.',
      es: 'Arriba del campo para escribir, la hora de salida y las acciones Editar, Enviar ya y Cancelar ahora van en letra chica y sin negrita, para que se lea el mensaje.',
      pt: 'Acima do campo de escrita, o horário de envio e as ações Editar, Enviar já e Cancelar agora ficam em letra menor e sem negrito, para a mensagem se destacar.',
    },
    { product: 'groups', en: 'The same in Lines.', es: 'Lo mismo en Lines.', pt: 'O mesmo no Lines.' },
  ],
} satisfies ChangelogEntry;
