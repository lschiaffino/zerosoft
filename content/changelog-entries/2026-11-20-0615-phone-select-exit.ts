import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0615-phone-select-exit',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines on the phone: unselecting the last message leaves selection',
    es: 'Inbox y Lines en el teléfono: sacar el último mensaje elegido sale de la selección',
    pt: 'Inbox e Lines no celular: desmarcar a última mensagem sai da seleção',
  },
  items: [
    {
      product: 'inbox',
      en: 'When you select messages with your finger and tap the selected ones again, the last one you unselect closes the selection bar and gives you the message field back, as in WhatsApp on the phone.',
      es: 'Cuando elegís mensajes con el dedo y volvés a tocar los elegidos, al sacar el último se cierra la barra de selección y vuelve el campo del mensaje, como en WhatsApp en el teléfono.',
      pt: 'Quando você seleciona mensagens com o dedo e toca de novo nas selecionadas, ao desmarcar a última a barra de seleção fecha e o campo da mensagem volta, como no WhatsApp no celular.',
    },
    {
      product: 'groups',
      en: 'Lines does the same.',
      es: 'Lines hace lo mismo.',
      pt: 'O Lines faz o mesmo.',
    },
  ],
} satisfies ChangelogEntry;
