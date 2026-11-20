import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-stickers-per-line',
  date: '2026-11-19',
  title: {
    en: 'Lines and Inbox: each number has its own stickers, and the tab opens right away',
    es: 'Lines e Inbox: cada número tiene sus stickers, y la pestaña abre enseguida',
    pt: 'Lines e Inbox: cada número tem suas figurinhas, e a aba abre na hora',
  },
  items: [
    {
      product: 'groups',
      en: 'The Stickers tab shows the stickers of the line the open chat belongs to (or the one picked in Reply from). Before, it mixed the stickers of all your lines. A sticker you create or add to favorites stays on the line of that chat.',
      es: 'La pestaña Stickers muestra los stickers de la línea del chat abierto (o de la elegida en Responder desde). Antes mezclaba los de todas tus líneas. Un sticker que creás o sumás a favoritos queda en la línea de ese chat.',
      pt: 'A aba Figurinhas mostra as figurinhas da linha da conversa aberta (ou da escolhida em Responder de). Antes misturava as de todas as suas linhas. Uma figurinha que você cria ou adiciona às favoritas fica na linha dessa conversa.',
    },
    {
      product: 'inbox',
      en: 'With more than one WhatsApp account, the Stickers tab shows the stickers of the account the open chat belongs to. A sticker now goes out on the account picked in Reply from.',
      es: 'Con más de una cuenta de WhatsApp, la pestaña Stickers muestra los stickers de la cuenta del chat abierto. Un sticker ahora sale por la cuenta elegida en Responder desde.',
      pt: 'Com mais de uma conta de WhatsApp, a aba Figurinhas mostra as figurinhas da conta da conversa aberta. Uma figurinha agora sai pela conta escolhida em Responder de.',
    },
    {
      product: 'groups',
      en: 'The Stickers tab shows what you already have as soon as you open it. Before, it first waited for the stickers that had arrived since the last time. Those now come in afterwards and fill the grid as they arrive, and a large collection shows 60 at a time.',
      es: 'La pestaña Stickers muestra lo que ya tenés apenas la abrís. Antes esperaba primero a traer los stickers que habían llegado desde la última vez. Ahora esos entran después y van llenando la grilla, y una colección grande muestra de a 60.',
      pt: 'A aba Figurinhas mostra o que você já tem assim que abre. Antes esperava primeiro trazer as figurinhas que tinham chegado desde a última vez. Agora elas entram depois e vão preenchendo a grade, e uma coleção grande mostra 60 por vez.',
    },
    {
      product: 'inbox',
      en: 'The Stickers tab no longer waits for WhatsApp before showing your stickers: it opens with what you have and adds the new ones afterwards.',
      es: 'La pestaña Stickers ya no espera a WhatsApp para mostrar tus stickers: abre con lo que tenés y suma los nuevos después.',
      pt: 'A aba Figurinhas não espera mais o WhatsApp para mostrar suas figurinhas: abre com o que você tem e adiciona as novas depois.',
    },
  ],
} satisfies ChangelogEntry;
