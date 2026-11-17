import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-load-older',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: load older messages from the phone',
    es: 'Inbox y Lines: cargar mensajes anteriores desde el teléfono',
    pt: 'Inbox e Lines: carregar mensagens anteriores do celular',
  },
  items: [
    {
      product: 'inbox',
      en: 'When you reach the top of a chat and there is nothing older stored, a "Load older messages" chip asks your phone for the 50 messages before the oldest one. They come in above without moving what you were reading. The chip says when WhatsApp has no more, lets you retry if it fails, and is disabled with the reason while the line is disconnected. The phone has to be online.',
      es: 'Cuando llegás arriba de todo en un chat y no hay nada más viejo guardado, una ficha "Cargar mensajes anteriores" le pide a tu teléfono los 50 mensajes anteriores al más viejo. Entran arriba sin mover lo que estabas leyendo. La ficha dice cuando WhatsApp no tiene más, deja reintentar si falla y queda deshabilitada con el motivo mientras la línea está desconectada. El teléfono tiene que estar en línea.',
      pt: 'Quando você chega ao topo de uma conversa e não há nada mais antigo guardado, uma ficha "Carregar mensagens anteriores" pede ao seu celular as 50 mensagens anteriores à mais antiga. Elas entram acima sem mover o que você estava lendo. A ficha avisa quando o WhatsApp não tem mais, deixa tentar de novo se falhar e fica desabilitada com o motivo enquanto a linha está desconectada. O celular precisa estar online.',
    },
    {
      product: 'groups',
      en: 'The same in Lines, for anyone who can see the chat. It first brings what our WhatsApp server already kept and then asks the phone.',
      es: 'Lo mismo en Lines, para quien pueda ver el chat. Primero trae lo que ya guardó nuestro servidor de WhatsApp y después le pide al teléfono.',
      pt: 'O mesmo no Lines, para quem pode ver a conversa. Primeiro traz o que o nosso servidor de WhatsApp já guardou e depois pede ao celular.',
    },
  ],
} satisfies ChangelogEntry;
