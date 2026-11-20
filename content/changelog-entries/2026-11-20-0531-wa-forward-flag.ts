import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0531-wa-forward-flag',
  date: '2026-11-20',
  title: {
    en: 'Messages forwarded from Lines and Inbox show "Forwarded" on the phone',
    es: 'Lo que se reenvía desde Lines e Inbox aparece como "Reenviado" en el teléfono',
    pt: 'O que é encaminhado pelo Lines e pelo Inbox aparece como "Encaminhada" no celular',
  },
  items: [
    {
      product: 'groups',
      en: 'A message forwarded from Lines (from its menu or by selecting several) used to reach WhatsApp as a new message, without the "Forwarded" label. Now it carries the same mark WhatsApp adds when you forward from the phone: "Forwarded", or "Forwarded many times" once it has been forwarded five times or more. Texts, photos, videos, documents, voice notes and stickers. Within the same line the original is forwarded as is, without uploading the file again. The chat in Lines also shows "Forwarded many times" when that applies.',
      es: 'Un mensaje reenviado desde Lines (desde su menú o eligiendo varios) llegaba a WhatsApp como un mensaje nuevo, sin la marca de "Reenviado". Ahora lleva la misma marca que pone WhatsApp al reenviar desde el teléfono: "Reenviado", o "Reenviado muchas veces" cuando ya se reenvió cinco veces o más. Textos, fotos, videos, documentos, notas de voz y stickers. En la misma línea se reenvía el original tal cual, sin volver a subir el archivo. El chat en Lines también muestra "Reenviado muchas veces" cuando corresponde.',
      pt: 'Uma mensagem encaminhada pelo Lines (pelo menu dela ou escolhendo várias) chegava ao WhatsApp como uma mensagem nova, sem a marca de "Encaminhada". Agora leva a mesma marca que o WhatsApp põe ao encaminhar pelo celular: "Encaminhada", ou "Encaminhada com frequência" quando já foi encaminhada cinco vezes ou mais. Textos, fotos, vídeos, documentos, notas de voz e figurinhas. Na mesma linha a original é encaminhada como está, sem enviar o arquivo de novo. O chat no Lines também mostra "Encaminhada com frequência" quando for o caso.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: what you forward to your WhatsApp chats arrives with the "Forwarded" label (or "Forwarded many times"), as when you forward from the phone.',
      es: 'Lo mismo en Inbox: lo que reenviás a tus chats de WhatsApp llega con la marca "Reenviado" (o "Reenviado muchas veces"), como al reenviar desde el teléfono.',
      pt: 'O mesmo no Inbox: o que você encaminha para as suas conversas do WhatsApp chega com a marca "Encaminhada" (ou "Encaminhada com frequência"), como ao encaminhar pelo celular.',
    },
  ],
} satisfies ChangelogEntry;
