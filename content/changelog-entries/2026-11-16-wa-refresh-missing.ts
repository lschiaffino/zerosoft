import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-wa-refresh-missing',
  date: '2026-11-16',
  title: {
    en: 'WhatsApp: "Fetch missing messages" goes back before the last message and tells you what it found',
    es: 'WhatsApp: "Traer mensajes que faltan" busca antes del último mensaje y te dice qué encontró',
    pt: 'WhatsApp: "Buscar mensagens que faltam" procura antes da última mensagem e diz o que encontrou',
  },
  items: [
    {
      product: 'inbox',
      en: '"Fetch missing messages" in the chat menu now asks your phone for the messages from the days before the last one, around any gap WhatsApp reported, and a bit further back. Before, it asked from the newest message the WhatsApp server had, which brought back only what you already had. What comes in lands in its place without duplicates.',
      es: '"Traer mensajes que faltan" en el menú del chat ahora le pide a tu teléfono los mensajes de los días anteriores al último, alrededor de los huecos que avisó WhatsApp y un poco más atrás. Antes pedía desde el mensaje más nuevo que tenía el servidor de WhatsApp, y eso traía solo lo que ya tenías. Lo que llega queda en su lugar, sin repetidos.',
      pt: '"Buscar mensagens que faltam" no menu da conversa agora pede ao seu celular as mensagens dos dias anteriores à última, em volta das lacunas que o WhatsApp avisou e um pouco mais para trás. Antes pedia a partir da mensagem mais nova que o servidor do WhatsApp tinha, e isso trazia só o que você já tinha. O que chega fica no lugar, sem repetidas.',
    },
    {
      product: 'groups',
      en: 'The same in Lines. A strip at the top of the chat shows the request in progress and then the result: how many messages came, that nothing was missing, that the phone did not answer (with a retry button), that the line is disconnected, that the line reached its hourly limit, or that the WhatsApp server needs an update to fetch from there.',
      es: 'Lo mismo en Lines. Una franja arriba del chat muestra el pedido en curso y después el resultado: cuántos mensajes llegaron, que no faltaba nada, que el teléfono no respondió (con un botón para reintentar), que la línea está desconectada, que la línea llegó a su tope por hora o que el servidor de WhatsApp necesita una actualización para pedir desde ahí.',
      pt: 'O mesmo no Lines. Uma faixa no topo da conversa mostra o pedido em andamento e depois o resultado: quantas mensagens chegaram, que não faltava nada, que o celular não respondeu (com um botão para tentar de novo), que a linha está desconectada, que a linha chegou ao limite por hora ou que o servidor do WhatsApp precisa de uma atualização para pedir a partir dali.',
    },
  ],
} satisfies ChangelogEntry;
