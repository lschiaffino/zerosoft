import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-reimport-safe',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: linking a line again keeps what you did',
    es: 'Inbox y Lines: volver a vincular una línea conserva lo que hiciste',
    pt: 'Inbox e Lines: vincular uma linha de novo mantém o que você fez',
  },
  items: [
    {
      product: 'inbox',
      en: 'Linking a WhatsApp line again, or importing its history again, no longer changes chats that were already here: a chat you had read stays read, one you took out of Archived stays out, and a pinned chat stays pinned. What the phone says about a chat (archived, unread) only applies to chats that come in new.',
      es: 'Volver a vincular una línea de WhatsApp, o importar de nuevo su historial, ya no cambia los chats que ya estaban: el que habías leído sigue leído, el que sacaste de Archivados sigue afuera y el fijado sigue fijado. Lo que dice el teléfono de un chat (archivado, no leídos) solo vale para los chats que entran nuevos.',
      pt: 'Vincular de novo uma linha do WhatsApp, ou importar de novo o histórico, não muda mais as conversas que já estavam: a que você leu continua lida, a que tirou de Arquivadas continua fora e a fixada continua fixada. O que o celular diz de uma conversa (arquivada, não lidas) só vale para as conversas que entram novas.',
    },
    {
      product: 'inbox',
      en: 'When two chats of the same person are joined into one, the audio or photo that can still be downloaded is the one that stays, together with its transcription.',
      es: 'Cuando dos chats de la misma persona se juntan en uno, queda el audio o la foto que todavía se puede bajar, con su transcripción.',
      pt: 'Quando duas conversas da mesma pessoa viram uma, fica o áudio ou a foto que ainda pode ser baixado, com a transcrição.',
    },
  ],
} satisfies ChangelogEntry;
